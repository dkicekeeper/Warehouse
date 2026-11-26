import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGithubApp } from '@/lib/github/app';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW } from '../helpers/factories';
import { PASSPORT, TASK } from '../standard/tree';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const REPO = 'dkicekeeper/Platina';

let calls: string[];
let routes: Record<string, () => unknown>;
let store: PgStore;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const key = `${init?.method ?? 'GET'} ${url.pathname}`;
  calls.push(key);
  const route = routes[key];
  if (!route) return json({ message: `no route for ${key}` }, 404);
  const out = route();
  return out instanceof Response ? out : json(out);
};
const app = () => createGithubApp({ appId: '12345', privateKey: PEM, fetchImpl: fakeFetch });
const blob = (text: string) => ({ encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n') });
const blobCalls = () => calls.filter((c) => c.includes('/git/blobs/'));

function repoWith(docsSha: string, entries: { path: string; sha: string; text: string }[]) {
  routes[`GET /repos/${REPO}/git/trees/main`] = () => ({
    tree: [{ path: 'README.md', type: 'blob', sha: 'r' }, { path: 'docs', type: 'tree', sha: docsSha }],
  });
  routes[`GET /repos/${REPO}/git/trees/${docsSha}`] = () => ({
    truncated: false,
    tree: [
      { path: 'backlog', type: 'tree', sha: 't' },
      { path: 'README.md', type: 'blob', sha: 'idx' },
      { path: 'archive/backlog/2026-01-01-old.md', type: 'blob', sha: 'old' },
      ...entries.map((e) => ({ path: e.path, type: 'blob', sha: e.sha })),
    ],
  });
  for (const e of entries) routes[`GET /repos/${REPO}/git/blobs/${e.sha}`] = () => blob(e.text);
}

beforeEach(async () => {
  ({ store } = await testStore());
  await store.ensureRepo(REPO, 'main', 'Platina');
  calls = [];
  routes = {
    'GET /app/installations': () => [{ id: 77 }],
    'POST /app/installations/77/access_tokens': () => ({ token: 'ghs_inst', expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    'GET /installation/repositories': () => ({ repositories: [{ full_name: REPO, name: 'Platina', default_branch: 'main' }] }),
  };
});

describe('syncDocs', () => {
  it('reads the passport and the records of a repository waiting for its first read', async () => {
    repoWith('d1', [
      { path: 'project.md', sha: 'p1', text: PASSPORT },
      { path: 'backlog/2026-11-26-attachments.md', sha: 'b1', text: TASK },
    ]);
    expect(await app().syncDocs(store, NOW)).toEqual({ read: 1, changed: 1 });
    const docs = await store.listDocs();
    expect(docs.map((d) => [d.kind, d.path, d.status])).toEqual([
      ['task', 'docs/backlog/2026-11-26-attachments.md', 'ready'],
      ['project', 'docs/project.md', 'live'],
    ]);
    expect(docs[0]?.title).toBe('Вложения после перезапуска');
    expect((await store.listDocsState())[0]).toMatchObject({ treeSha: 'd1', dirty: false, syncedAt: NOW });
    expect(blobCalls()).toHaveLength(2);
  });

  it('does not touch a repository that is not marked', async () => {
    repoWith('d1', [{ path: 'project.md', sha: 'p1', text: PASSPORT }]);
    await app().syncDocs(store, NOW);
    calls = [];
    expect(await app().syncDocs(store, NOW)).toEqual({ read: 0, changed: 0 });
    expect(calls.filter((c) => c.includes('/git/'))).toEqual([]);
  });

  it('reads every repository when asked for all, and stops at an unchanged docs tree', async () => {
    repoWith('d1', [{ path: 'project.md', sha: 'p1', text: PASSPORT }]);
    await app().syncDocs(store, NOW);
    calls = [];
    expect(await app().syncDocs(store, NOW, { all: true })).toEqual({ read: 1, changed: 0 });
    expect(calls.filter((c) => c.includes('/git/'))).toEqual([`GET /repos/${REPO}/git/trees/main`]);
  });

  it('fetches only the files that changed and drops the ones that are gone', async () => {
    repoWith('d1', [
      { path: 'project.md', sha: 'p1', text: PASSPORT },
      { path: 'backlog/2026-11-26-attachments.md', sha: 'b1', text: TASK },
      { path: 'backlog/2026-11-26-gone.md', sha: 'g1', text: TASK },
    ]);
    await app().syncDocs(store, NOW);
    await store.markDocsDirty(REPO);
    calls = [];
    repoWith('d2', [
      { path: 'project.md', sha: 'p1', text: PASSPORT },
      { path: 'backlog/2026-11-26-attachments.md', sha: 'b2', text: TASK.replace('status: ready', 'status: in-progress') },
    ]);
    expect(await app().syncDocs(store, NOW)).toEqual({ read: 1, changed: 1 });
    expect(blobCalls()).toEqual([`GET /repos/${REPO}/git/blobs/b2`]);
    const docs = await store.listRepoDocs(REPO);
    expect(docs.map((d) => d.status)).toEqual(['in-progress', 'live']);
  });

  it('empties a repository that has no docs folder', async () => {
    repoWith('d1', [{ path: 'project.md', sha: 'p1', text: PASSPORT }]);
    await app().syncDocs(store, NOW);
    await store.markDocsDirty(REPO);
    routes[`GET /repos/${REPO}/git/trees/main`] = () => ({ tree: [{ path: 'README.md', type: 'blob', sha: 'r' }] });
    await app().syncDocs(store, NOW);
    expect(await store.listDocs()).toEqual([]);
    expect((await store.listDocsState())[0]).toMatchObject({ dirty: false });
  });

  it('reports a repository it could not read and still reads the others', async () => {
    await store.ensureRepo('dkicekeeper/Tenra', 'main', 'Tenra');
    routes['GET /installation/repositories'] = () => ({
      repositories: [{ full_name: REPO, default_branch: 'main' }, { full_name: 'dkicekeeper/Tenra', default_branch: 'main' }],
    });
    repoWith('d1', [{ path: 'project.md', sha: 'p1', text: PASSPORT }]);
    await expect(app().syncDocs(store, NOW)).rejects.toThrow(/Tenra/);
    expect(await store.listRepoDocs(REPO)).toHaveLength(1);
    expect((await store.listDocsState()).find((s) => s.repo === 'dkicekeeper/Tenra')?.dirty).toBe(true);
  });
});
