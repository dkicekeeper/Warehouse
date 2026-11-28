import { beforeEach, describe, expect, it } from 'vitest';
import { handleReconcile, handleSessionReport } from '@/lib/api/report';
import { verifyBearer } from '@/lib/auth/bearer';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW } from '../helpers/factories';

const TOKEN = 'rpt_secret_token';
let store: PgStore;
let after: number;
beforeEach(async () => {
  ({ store } = await testStore());
  after = 0;
});

const deps = (over = {}) => ({
  store,
  now: NOW,
  token: TOKEN,
  afterIngest: async () => {
    after++;
  },
  ...over,
});

const post = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  new Request('https://w.example/api/report/session', {
    method: 'POST',
    headers: auth ? { authorization: auth, 'content-type': 'application/json' } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const report = (over: Record<string, unknown> = {}) => ({
  session_id: 'session_016AbC',
  repo: 'dkicekeeper/Platina',
  branch: 'claude/x',
  message_tail: 'Статус: готово — смержено',
  sent_at: NOW.toISOString(),
  ...over,
});

describe('verifyBearer', () => {
  const req = (auth?: string) => new Request('https://w.example', { headers: auth ? { authorization: auth } : {} });
  it('accepts the exact token only', () => {
    expect(verifyBearer(req(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
    expect(verifyBearer(req(`bearer ${TOKEN}`), TOKEN)).toBe(true);
    expect(verifyBearer(req(`Bearer ${TOKEN}x`), TOKEN)).toBe(false);
    expect(verifyBearer(req(`Bearer ${TOKEN.slice(0, -1)}`), TOKEN)).toBe(false);
    expect(verifyBearer(req(TOKEN), TOKEN)).toBe(false);
    expect(verifyBearer(req(), TOKEN)).toBe(false);
  });
  it('rejects everything when no token is configured', () => {
    expect(verifyBearer(req('Bearer '), '')).toBe(false);
    expect(verifyBearer(req('Bearer undefined'), '')).toBe(false);
  });
});

describe('POST /api/report/session', () => {
  it('stores the report, marks the hook source healthy, recomputes, answers 204', async () => {
    const res = await handleSessionReport(post(report()), deps());
    expect(res.status).toBe(204);
    expect(await store.getSession('session_016AbC')).toMatchObject({ state: 'done', stateText: 'смержено' });
    expect(await store.getSources()).toMatchObject([{ source: 'session_hook', lastOkAt: NOW }]);
    expect(after).toBe(1);
  });

  it.each([
    ['no', null],
    ['a wrong', 'Bearer nope'],
    ['the placeholder the hook sends when the proxy did not inject one', 'Bearer proxy-injected'],
  ])('%s token → an empty 401 and nothing stored', async (_n, auth) => {
    const res = await handleSessionReport(post(report(), auth), deps());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
    expect(await store.getSession('session_016AbC')).toBeNull();
    expect(after).toBe(0);
  });

  it.each([
    ['not JSON', 'oops'],
    ['a missing session id', report({ session_id: undefined })],
    ['an empty session id', report({ session_id: '' })],
    ['a session id with markup', report({ session_id: 'session_<script>' })],
    ['a session id with spaces', report({ session_id: 'session 1' })],
    ['a session id that is neither session_… nor a UUID', report({ session_id: '../../etc' })],
    ['a repository that is not owner/name', report({ repo: 'https://github.com/a/b' })],
    ['a message tail over 4000 characters', report({ message_tail: 'x'.repeat(4001) })],
    ['a date that is not a date', report({ sent_at: 'yesterday' })],
  ])('%s → 400 and nothing stored', async (_n, body) => {
    const res = await handleSessionReport(post(body), deps());
    expect(res.status).toBe(400);
    expect(await store.getSession('session_016AbC')).toBeNull();
  });

  it('accepts the id of a local session, a UUID', async () => {
    const res = await handleSessionReport(post(report({ session_id: '20e570d0-daba-559b-8477-09337c2e3975' })), deps());
    expect(res.status).toBe(204);
  });

  it('accepts a session with no repository', async () => {
    const res = await handleSessionReport(post(report({ repo: null, branch: null })), deps());
    expect(res.status).toBe(204);
  });

  it('a failing recompute still answers 204: the report is stored', async () => {
    const res = await handleSessionReport(
      post(report()),
      deps({
        afterIngest: async () => {
          throw new Error('boom');
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(await store.getSession('session_016AbC')).not.toBeNull();
  });
});

describe('POST /api/report/sessions', () => {
  const batch = (n = 1) => ({
    sessions: Array.from({ length: n }, (_, i) => ({
      session_id: `session_${i}`,
      title: `S${i}`,
      archived: false,
      bucket: 'completed',
      unread: false,
      summary: null,
      updated_at: NOW.toISOString(),
    })),
  });

  it('stores the batch, marks the reconcile source healthy, answers 204', async () => {
    const res = await handleReconcile(post(batch(3)), deps());
    expect(res.status).toBe(204);
    expect(await store.getSession('session_2')).toMatchObject({ title: 'S2' });
    expect(await store.getSources()).toMatchObject([{ source: 'reconcile', lastOkAt: NOW }]);
    expect(after).toBe(1);
  });

  it('one session with an odd id is dropped; the rest of the batch is stored', async () => {
    const b = batch(2);
    b.sessions[0]!.session_id = 'session_../../x';
    expect((await handleReconcile(post(b), deps())).status).toBe(204);
    expect(await store.getSession('session_1')).toMatchObject({ title: 'S1' });
    expect(await store.getSession('session_../../x')).toBeNull();
  });

  it('marks the hook source unhealthy when sessions changed without reporting', async () => {
    await handleSessionReport(post(report({ session_id: 'session_0' })), deps({ now: new Date(NOW.getTime() - 120 * 60_000) }));
    await handleReconcile(post(batch(1)), deps());
    expect((await store.getSources()).find((s) => s.source === 'session_hook')).toMatchObject({
      lastErrorAt: NOW,
      note: 'сессий обновилось без отчёта хука: 1',
    });
  });

  it('requires the token', async () => {
    expect((await handleReconcile(post(batch(), null), deps())).status).toBe(401);
  });

  it('rejects an unknown bucket, and more than 500 sessions', async () => {
    const bad = batch();
    (bad.sessions[0] as Record<string, unknown>).bucket = 'thinking';
    expect((await handleReconcile(post(bad), deps())).status).toBe(400);
    expect((await handleReconcile(post(batch(501)), deps())).status).toBe(400);
  });

  it('truncates an over-long summary instead of rejecting the batch', async () => {
    const b = batch();
    (b.sessions[0] as Record<string, unknown>).summary = 'я'.repeat(900);
    expect((await handleReconcile(post(b), deps())).status).toBe(204);
    expect((await store.getSession('session_0'))?.reconcile?.summary?.length).toBe(600);
  });
});
