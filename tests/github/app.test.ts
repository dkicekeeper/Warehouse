import { generateKeyPairSync, createVerify } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGithubApp } from '@/lib/github/app';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW, minutesAgo, pr as prFactory, run as runFactory } from '../helpers/factories';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const REPO = 'dkicekeeper/Platina';

type Call = { method: string; path: string; auth: string | null };
let calls: Call[];
let routes: Record<string, (call: Call) => unknown>;
let store: PgStore;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const call: Call = {
    method: init?.method ?? 'GET',
    path: url.pathname + url.search,
    auth: new Headers(init?.headers).get('authorization'),
  };
  calls.push(call);
  const key = `${call.method} ${url.pathname}`;
  const route = routes[key];
  if (!route) return json({ message: `no route for ${key}` }, 404);
  const out = route(call);
  return out instanceof Response ? out : json(out);
};

const app = () => createGithubApp({ appId: '12345', privateKey: PEM, fetchImpl: fakeFetch });

const ghPr = (over: Record<string, unknown> = {}) => ({
  number: 3,
  title: 'InfoTip',
  state: 'open',
  draft: false,
  merged: false,
  mergeable: true,
  head: { ref: 'claude/infotip-a1', sha: 'aaa111' },
  created_at: '2026-11-25T05:30:00Z',
  updated_at: '2026-11-25T06:00:00Z',
  ...over,
});

beforeEach(async () => {
  ({ store } = await testStore());
  calls = [];
  routes = {
    'GET /app/installations': () => [{ id: 77 }],
    'POST /app/installations/77/access_tokens': () => ({ token: 'ghs_inst', expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    'GET /installation/repositories': () => ({ repositories: [{ full_name: REPO, name: 'Platina', default_branch: 'main' }] }),
    [`GET /repos/${REPO}/pulls`]: () => [ghPr({ mergeable: undefined })],
    [`GET /repos/${REPO}/pulls/3`]: () => ghPr(),
    [`GET /repos/${REPO}/pulls/3/commits`]: () => [
      { commit: { message: 'Add tip\n\nCo-Authored-By: x\nClaude-Session: https://claude.ai/code/session_016AbC' } },
    ],
    [`GET /repos/${REPO}/actions/runs`]: () => ({ workflow_runs: [] }),
  };
});

describe('authentication', () => {
  it('signs app requests with an RS256 JWT for the app id, and repository requests with the installation token', async () => {
    await app().resync(store, NOW);
    const first = calls.find((c) => c.path.startsWith('/app/installations'));
    const jwt = first?.auth?.replace('Bearer ', '') ?? '';
    const [h, p, sig] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
    expect(calls.find((c) => c.path.startsWith(`/repos/${REPO}/pulls`))?.auth).toBe('Bearer ghs_inst');
  });

  it('reuses the installation token between calls', async () => {
    const a = app();
    await a.resync(store, NOW);
    await a.resync(store, NOW);
    expect(calls.filter((c) => c.path.endsWith('/access_tokens'))).toHaveLength(1);
  });

  it('reports a GitHub error with its status', async () => {
    routes['GET /app/installations'] = () => json({ message: 'Bad credentials' }, 401);
    await expect(app().resync(store, NOW)).rejects.toThrow(/401.*Bad credentials/);
  });
});

describe('resync', () => {
  it('registers repositories and stores open PRs with mergeable and the session from the commit trailer', async () => {
    await app().resync(store, NOW);
    expect((await store.loadSnapshot(NOW)).repos).toMatchObject([{ fullName: REPO, defaultBranch: 'main' }]);
    expect(await store.getPr(REPO, 3)).toMatchObject({ state: 'open', mergeable: true, sessionId: 'session_016AbC' });
  });

  it('learns the checks of a PR whose runs finished days ago, by asking for the runs of its head commit', async () => {
    routes[`GET /repos/${REPO}/actions/runs`] = (call) =>
      call.path.includes('head_sha=aaa111')
        ? {
            workflow_runs: [
              {
                id: 8001, name: 'iOS', head_branch: 'claude/infotip-a1', head_sha: 'aaa111', event: 'push',
                status: 'completed', conclusion: 'success',
                created_at: minutesAgo(9 * 1440).toISOString(), run_started_at: minutesAgo(9 * 1440).toISOString(),
                updated_at: minutesAgo(9 * 1440 - 30).toISOString(),
              },
            ],
          }
        : { workflow_runs: [] };
    await app().resync(store, NOW);
    expect((await store.getPr(REPO, 3))?.checks).toBe('success');
  });

  it('does not ask for commits again once the session is known', async () => {
    const a = app();
    await a.resync(store, NOW);
    calls = [];
    await a.resync(store, NOW);
    expect(calls.some((c) => c.path.includes('/commits'))).toBe(false);
  });

  it('closes a stored PR that GitHub no longer lists as open', async () => {
    await store.upsertPr(prFactory({ repo: REPO, number: 8, updatedAt: minutesAgo(600) }));
    routes[`GET /repos/${REPO}/pulls/8`] = () => ghPr({ number: 8, state: 'closed', merged: true, updated_at: NOW.toISOString() });
    await app().resync(store, NOW);
    expect((await store.getPr(REPO, 8))?.state).toBe('merged');
  });

  it('stores the last day of runs, and the jobs of those still going', async () => {
    const ghRun = (over: Record<string, unknown>) => ({
      id: 9001,
      name: 'iOS',
      head_branch: 'claude/infotip-a1',
      head_sha: 'aaa111',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-11-25T06:01:00Z',
      run_started_at: '2026-11-25T06:01:00Z',
      updated_at: '2026-11-25T06:40:00Z',
      ...over,
    });
    routes[`GET /repos/${REPO}/actions/runs`] = () => ({
      workflow_runs: [ghRun({}), ghRun({ id: 9002, status: 'in_progress', conclusion: null })],
    });
    routes[`GET /repos/${REPO}/actions/runs/9002/jobs`] = () => ({
      jobs: [{ id: 7002, run_id: 9002, name: 'build-and-test', labels: ['xcode-27'], status: 'in_progress', conclusion: null, created_at: '2026-11-25T06:01:05Z', started_at: '2026-11-25T06:20:00Z', completed_at: null }],
    });
    await app().resync(store, NOW);
    expect((await store.getRun(9001))?.status).toBe('completed');
    expect((await store.getRun(9002))?.status).toBe('in_progress');
    expect(await store.getJob(7002)).toMatchObject({ status: 'in_progress', labels: ['xcode-27'] });
    expect((await store.getPr(REPO, 3))?.checks).toBe('pending');
    const listed = calls.find((c) => c.path.startsWith(`/repos/${REPO}/actions/runs?`) && c.path.includes('created='));
    expect(decodeURIComponent(listed?.path ?? '')).toContain(`created=>=${minutesAgo(1440).toISOString()}`);
    expect(calls.some((c) => c.path.includes('/runs/9001/jobs'))).toBe(false);
  });

  it('catches up on a stored live run that has dropped out of the listing', async () => {
    await store.upsertRun(runFactory({ id: 5, repo: REPO, status: 'in_progress', conclusion: null, completedAt: null, createdAt: minutesAgo(3000) }));
    routes[`GET /repos/${REPO}/actions/runs/5`] = () => ({
      id: 5, name: 'CI', head_branch: 'x', head_sha: 's', event: 'push', status: 'completed', conclusion: 'cancelled',
      created_at: minutesAgo(3000).toISOString(), run_started_at: minutesAgo(3000).toISOString(), updated_at: NOW.toISOString(),
    });
    routes[`GET /repos/${REPO}/actions/runs/5/jobs`] = () => ({ jobs: [] });
    await app().resync(store, NOW);
    expect(await store.getRun(5)).toMatchObject({ status: 'completed', conclusion: 'cancelled' });
  });

  it('one repository failing does not stop the others, and the error is reported', async () => {
    routes['GET /installation/repositories'] = () => ({
      repositories: [
        { full_name: 'dkicekeeper/Broken', name: 'Broken', default_branch: 'main' },
        { full_name: REPO, name: 'Platina', default_branch: 'main' },
      ],
    });
    await expect(app().resync(store, NOW)).rejects.toThrow(/dkicekeeper\/Broken/);
    expect(await store.getPr(REPO, 3)).not.toBeNull();
  });
});

describe('actions', () => {
  it('cancelRun posts to the cancel endpoint with the installation token', async () => {
    routes[`POST /repos/${REPO}/actions/runs/9002/cancel`] = () => new Response(null, { status: 202 });
    await app().cancelRun(REPO, 9002);
    expect(calls.at(-1)).toEqual({ method: 'POST', path: `/repos/${REPO}/actions/runs/9002/cancel`, auth: 'Bearer ghs_inst' });
  });

  it('cancelRun for a repository the app is not installed on fails clearly', async () => {
    await expect(app().cancelRun('someone/else', 1)).rejects.toThrow(/не установлено/);
  });

  it('enrichPr stores mergeable and the session for one PR', async () => {
    await store.ensureRepo(REPO, 'main', 'Platina');
    await app().enrichPr(store, REPO, 3);
    expect(await store.getPr(REPO, 3)).toMatchObject({ mergeable: true, sessionId: 'session_016AbC' });
  });

  it('failedDeliveriesSince counts deliveries that did not get a 2xx', async () => {
    routes['GET /app/hook/deliveries'] = () => [
      { delivered_at: minutesAgo(5).toISOString(), status_code: 500 },
      { delivered_at: minutesAgo(10).toISOString(), status_code: 200 },
      { delivered_at: minutesAgo(20).toISOString(), status_code: 0 },
      { delivered_at: minutesAgo(90).toISOString(), status_code: 500 },
    ];
    expect(await app().failedDeliveriesSince(minutesAgo(60))).toBe(2);
  });
});
