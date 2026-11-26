import { beforeEach, describe, expect, it } from 'vitest';
import { applyReconcileBatch, applySessionReport } from '@/lib/ingest/sessions';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW, minutesAgo, pr } from '../helpers/factories';

let store: PgStore;
beforeEach(async () => {
  ({ store } = await testStore());
});

const report = (over: Record<string, unknown> = {}) => ({
  session_id: 'session_016AbC',
  repo: 'dkicekeeper/Platina',
  branch: 'claude/infotip-a1',
  message_tail: 'CI зелёный.\n\nСтатус: ждёт владельца — смержить PR #3',
  sent_at: NOW.toISOString(),
  ...over,
});

const reconciled = (over: Record<string, unknown> = {}) => ({
  session_id: 'session_016AbC',
  title: 'Add an InfoTip',
  archived: false,
  bucket: 'review_ready' as const,
  unread: true,
  summary: 'PR #3 без конфликтов; смержить вручную',
  updated_at: minutesAgo(5).toISOString(),
  ...over,
});

describe('applySessionReport', () => {
  it('stores the parsed state and its text, and nothing else of the message', async () => {
    await applySessionReport(store, report(), NOW);
    expect(await store.getSession('session_016AbC')).toEqual({
      id: 'session_016AbC',
      projectId: null,
      repo: 'dkicekeeper/Platina',
      branch: 'claude/infotip-a1',
      title: null,
      state: 'needs_owner',
      stateText: 'смержить PR #3',
      reportedAt: NOW,
      archived: false,
      reconcile: null,
    });
  });

  it('takes the project of a known repository', async () => {
    const repo = await store.ensureRepo('dkicekeeper/Platina', 'main', 'Platina');
    await applySessionReport(store, report(), NOW);
    expect((await store.getSession('session_016AbC'))?.projectId).toBe(repo.projectId);
  });

  it('a message without a status line is unknown, keeping at most 300 characters', async () => {
    await applySessionReport(store, report({ message_tail: 'х'.repeat(2000) }), NOW);
    const s = await store.getSession('session_016AbC');
    expect(s?.state).toBe('unknown');
    expect(s?.stateText.length).toBeLessThanOrEqual(300);
  });

  it('uses the time the server received the report, not the time the sender claims', async () => {
    await applySessionReport(store, report({ sent_at: '2020-01-01T00:00:00Z' }), NOW);
    expect((await store.getSession('session_016AbC'))?.reportedAt).toEqual(NOW);
  });

  it('links the session to the open PR of the same repository and branch', async () => {
    await store.upsertPr(pr({ repo: 'dkicekeeper/Platina', number: 3, branch: 'claude/infotip-a1' }));
    await applySessionReport(store, report(), NOW);
    expect((await store.getPr('dkicekeeper/Platina', 3))?.sessionId).toBe('session_016AbC');
  });

  it('does not take a PR over from the session a commit trailer already named', async () => {
    await store.upsertPr(pr({ repo: 'dkicekeeper/Platina', number: 3, branch: 'claude/infotip-a1', sessionId: 'session_author' }));
    await applySessionReport(store, report(), NOW);
    expect((await store.getPr('dkicekeeper/Platina', 3))?.sessionId).toBe('session_author');
  });

  it('a session outside any repository keeps the project the owner gave it', async () => {
    const repo = await store.ensureRepo('dkicekeeper/Tenra', 'main', 'Tenra');
    await store.upsertSession({ id: 'session_016AbC', projectId: repo.projectId });
    await applySessionReport(store, report({ repo: null, branch: null }), NOW);
    expect(await store.getSession('session_016AbC')).toMatchObject({ projectId: repo.projectId, repo: null, state: 'needs_owner' });
  });

  it('a report revives an archived session', async () => {
    await store.upsertSession({ id: 'session_016AbC', archived: true });
    await applySessionReport(store, report(), NOW);
    expect((await store.getSession('session_016AbC'))?.archived).toBe(false);
  });

  it('keeps the title the reconcile gave', async () => {
    await applyReconcileBatch(store, { sessions: [reconciled()] });
    await applySessionReport(store, report(), NOW);
    expect((await store.getSession('session_016AbC'))?.title).toBe('Add an InfoTip');
  });
});

describe('applyReconcileBatch', () => {
  it('creates a session it has not seen, without a project', async () => {
    await applyReconcileBatch(store, { sessions: [reconciled({ session_id: 'session_new', title: 'Otbasy' })] });
    expect(await store.getSession('session_new')).toEqual({
      id: 'session_new',
      projectId: null,
      repo: null,
      branch: null,
      title: 'Otbasy',
      state: 'unknown',
      stateText: '',
      reportedAt: null,
      archived: false,
      reconcile: { bucket: 'review_ready', unread: true, summary: 'PR #3 без конфликтов; смержить вручную', updatedAt: minutesAgo(5) },
    });
  });

  it('never overwrites what the hook reported', async () => {
    await applySessionReport(store, report(), minutesAgo(30));
    await applyReconcileBatch(store, { sessions: [reconciled({ bucket: 'completed', unread: false })] });
    expect(await store.getSession('session_016AbC')).toMatchObject({
      state: 'needs_owner',
      stateText: 'смержить PR #3',
      reportedAt: minutesAgo(30),
      repo: 'dkicekeeper/Platina',
      branch: 'claude/infotip-a1',
      title: 'Add an InfoTip',
      reconcile: { bucket: 'completed', unread: false },
    });
  });

  it('archives and un-archives as the list says', async () => {
    await applySessionReport(store, report(), minutesAgo(30));
    await applyReconcileBatch(store, { sessions: [reconciled({ archived: true })] });
    expect((await store.getSession('session_016AbC'))?.archived).toBe(true);
  });

  it('a session a PR names in its commits gets that PR’s project, repository and branch', async () => {
    const repo = await store.ensureRepo('dkicekeeper/Platina', 'main', 'Platina');
    await store.upsertPr(pr({ repo: 'dkicekeeper/Platina', number: 3, branch: 'claude/infotip-a1', sessionId: 'session_016AbC' }));
    await applyReconcileBatch(store, { sessions: [reconciled()] });
    expect(await store.getSession('session_016AbC')).toMatchObject({
      projectId: repo.projectId,
      repo: 'dkicekeeper/Platina',
      branch: 'claude/infotip-a1',
    });
  });

  it('does not move a session whose project the owner chose', async () => {
    const tenra = await store.ensureRepo('dkicekeeper/Tenra', 'main', 'Tenra');
    await store.ensureRepo('dkicekeeper/Platina', 'main', 'Platina');
    await store.upsertSession({ id: 'session_016AbC', projectId: tenra.projectId });
    await store.upsertPr(pr({ repo: 'dkicekeeper/Platina', number: 3, sessionId: 'session_016AbC' }));
    await applyReconcileBatch(store, { sessions: [reconciled()] });
    expect((await store.getSession('session_016AbC'))?.projectId).toBe(tenra.projectId);
  });

  it('handles an empty batch', async () => {
    await expect(applyReconcileBatch(store, { sessions: [] })).resolves.toBeUndefined();
  });
});
