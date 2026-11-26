import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectDoc } from '@/lib/domain/docs';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW, minutesAgo } from '../helpers/factories';

const REPO = 'dkicekeeper/Platina';
let store: PgStore;

const doc = (over: Partial<ProjectDoc> = {}): ProjectDoc => ({
  repo: REPO,
  path: 'docs/backlog/2026-11-26-device-check.md',
  kind: 'task',
  id: '2026-11-26-device-check',
  title: 'Проверка на устройстве',
  status: 'blocked',
  fields: { status: 'blocked', priority: 1, 'needs-owner': 'проверить на iPhone', tasks: ['a', 'b'], links: { site: 'https://x' } },
  body: 'Зачем: видно только на телефоне.',
  blobSha: 'aaa',
  ...over,
});

beforeEach(async () => {
  ({ store } = await testStore());
  await store.ensureRepo(REPO, 'main', 'Platina');
});

describe('project documents in the store', () => {
  it('starts with every repository waiting for its first read', async () => {
    expect(await store.listDocsState()).toEqual([{ repo: REPO, defaultBranch: 'main', treeSha: null, dirty: true, syncedAt: null }]);
    expect(await store.listDocs()).toEqual([]);
  });

  it('keeps what a repository holds, fields and all, and remembers the tree it read', async () => {
    const passport = doc({ path: 'docs/project.md', kind: 'project', id: 'project', title: 'Platina', status: 'beta', fields: { name: 'Platina', stage: 'beta' }, body: '' });
    await store.replaceRepoDocs(REPO, [doc(), passport], 'tree1', NOW);
    const docs = await store.listDocs();
    expect(docs).toHaveLength(2);
    expect(docs.find((d) => d.kind === 'task')).toEqual(doc());
    expect(docs.find((d) => d.kind === 'project')).toEqual(passport);
    expect(await store.listDocsState()).toEqual([{ repo: REPO, defaultBranch: 'main', treeSha: 'tree1', dirty: false, syncedAt: NOW }]);
  });

  it('replaces the whole set: changed files change, gone files go', async () => {
    await store.replaceRepoDocs(REPO, [doc(), doc({ path: 'docs/backlog/2026-11-26-old.md', id: '2026-11-26-old' })], 'tree1', minutesAgo(5));
    await store.replaceRepoDocs(REPO, [doc({ status: 'ready', title: 'Новое имя', blobSha: 'bbb' })], 'tree2', NOW);
    const docs = await store.listRepoDocs(REPO);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ status: 'ready', title: 'Новое имя', blobSha: 'bbb' });
  });

  it('leaves other repositories alone', async () => {
    await store.ensureRepo('dkicekeeper/Tenra', 'main', 'Tenra');
    await store.replaceRepoDocs('dkicekeeper/Tenra', [doc({ repo: 'dkicekeeper/Tenra' })], 't', NOW);
    await store.replaceRepoDocs(REPO, [], 'tree1', NOW);
    expect((await store.listDocs()).map((d) => d.repo)).toEqual(['dkicekeeper/Tenra']);
  });

  it('marks a repository to be read again', async () => {
    await store.replaceRepoDocs(REPO, [doc()], 'tree1', NOW);
    await store.markDocsDirty(REPO);
    expect((await store.listDocsState())[0]).toMatchObject({ dirty: true, treeSha: 'tree1' });
    await store.markDocsDirty('nobody/nothing');
  });
});
