import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DesiredItem } from '@/lib/domain/attention';
import { DEFAULT_SETTINGS } from '@/lib/domain/types';
import type { PgStore, Sql } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW, job, minutesAgo, minutesFromNow, pr, run, session } from '../helpers/factories';

let store: PgStore;
let sql: Sql;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ store, sql, close } = await testStore());
});
afterEach(() => close());

const desired = (over: Partial<DesiredItem> = {}): DesiredItem => ({
  key: 'pr:o/r#3',
  kind: 'pr_ready',
  level: 'request',
  projectId: null,
  text: 'PR #3 — готов к мержу',
  sessionId: null,
  pr: { repo: 'o/r', number: 3 },
  repo: 'o/r',
  since: minutesAgo(10),
  ...over,
});

describe('settings', () => {
  it('start at the defaults', async () => {
    expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('patch keeps the rest', async () => {
    const code = { code: 'abc', expiresAt: minutesFromNow(15) };
    await store.patchSettings({ macosLimit: 3, quietStart: '22:00', telegramLinkCode: code, lastDigestAt: NOW });
    expect(await store.getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      macosLimit: 3,
      quietStart: '22:00',
      telegramLinkCode: code,
      lastDigestAt: NOW,
    });
    await store.patchSettings({ telegramLinkCode: null });
    expect((await store.getSettings()).telegramLinkCode).toBeNull();
    expect((await store.getSettings()).macosLimit).toBe(3);
  });
});

describe('repos and projects', () => {
  it('a new repository gets a project of the given name; a known one keeps its project', async () => {
    const first = await store.ensureRepo('o/AutoParts4x4', 'main', 'Baja.kz');
    const again = await store.ensureRepo('o/AutoParts4x4', 'master', 'ignored');
    expect(again.projectId).toBe(first.projectId);
    expect(again.defaultBranch).toBe('master');
    const snap = await store.loadSnapshot(NOW);
    expect(snap.projects).toEqual([{ id: first.projectId, name: 'Baja.kz' }]);
    expect(snap.repos).toEqual([{ fullName: 'o/AutoParts4x4', projectId: first.projectId, defaultBranch: 'master' }]);
  });

  it('moving a repository into another project drops the project left empty', async () => {
    const tenra = await store.ensureRepo('o/Tenra', 'main', 'Tenra');
    const assets = await store.ensureRepo('o/tenra-assets', 'main', 'tenra-assets');
    await store.moveRepo('o/tenra-assets', tenra.projectId);
    await store.renameProject(tenra.projectId, 'Tenra!');
    const snap = await store.loadSnapshot(NOW);
    expect(snap.projects).toEqual([{ id: tenra.projectId, name: 'Tenra!' }]);
    expect(snap.repos.map((r) => r.projectId)).toEqual([tenra.projectId, tenra.projectId]);
    expect(assets.projectId).not.toBe(tenra.projectId);
  });
});

describe('sessions', () => {
  it('round-trips a full session', async () => {
    const s = session({
      projectId: null,
      state: 'needs_owner',
      stateText: 'смержить',
      reconcile: { bucket: 'blocked', unread: true, summary: 'x', updatedAt: minutesAgo(3) },
    });
    await store.upsertSession(s);
    expect(await store.getSession(s.id)).toEqual(s);
  });

  it('a partial update touches only the fields it names', async () => {
    const s = session({ projectId: null, state: 'working', stateText: 'жду CI', title: null });
    await store.upsertSession(s);
    await store.upsertSession({ id: s.id, title: 'Tenra Маркетинг', archived: true });
    expect(await store.getSession(s.id)).toEqual({ ...s, title: 'Tenra Маркетинг', archived: true });
  });

  it('a session first seen through a partial update gets safe defaults', async () => {
    await store.upsertSession({ id: 'session_new', title: 'Otbasy' });
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
      reconcile: null,
    });
  });

  it('the snapshot leaves out archived sessions unless they are blocked', async () => {
    const live = session({ projectId: null });
    const archived = session({ projectId: null, archived: true });
    const blocked = session({
      projectId: null,
      archived: true,
      reconcile: { bucket: 'blocked', unread: false, summary: null, updatedAt: minutesAgo(3) },
    });
    for (const s of [live, archived, blocked]) await store.upsertSession(s);
    const ids = (await store.loadSnapshot(NOW)).sessions.map((s) => s.id).sort();
    expect(ids).toEqual([live.id, blocked.id].sort());
  });

  it('the snapshot drops sessions quiet for over 30 days unless they still need the owner', async () => {
    const old = session({ projectId: null, state: 'done', reportedAt: minutesAgo(31 * 1440) });
    const oldAsk = session({ projectId: null, state: 'needs_owner', reportedAt: minutesAgo(31 * 1440) });
    for (const s of [old, oldAsk]) await store.upsertSession(s);
    expect((await store.loadSnapshot(NOW)).sessions.map((s) => s.id)).toEqual([oldAsk.id]);
  });
});

describe('pull requests, runs and jobs', () => {
  it('round-trip and are found by branch and head', async () => {
    const p = pr({ number: 3, mergeable: null, sessionId: 'session_a' });
    const r = run({ headSha: p.headSha });
    const j = job({ runId: r.id, labels: ['xcode-27', 'self-hosted'] });
    await store.upsertPr(p);
    await store.upsertRun(r);
    await store.upsertJob(j);
    expect(await store.getPr('o/r', 3)).toEqual(p);
    expect(await store.getRun(r.id)).toEqual(r);
    expect(await store.getJob(j.id)).toEqual(j);
    expect(await store.findOpenPr('o/r', p.branch)).toEqual(p);
    expect(await store.listOpenPrsByHead('o/r', p.headSha)).toEqual([p]);
    expect(await store.listRunsByHead('o/r', p.headSha)).toEqual([r]);
    expect(await store.getPr('o/r', 999)).toBeNull();
  });

  it('upsert overwrites', async () => {
    const p = pr({ number: 3 });
    await store.upsertPr(p);
    await store.upsertPr({ ...p, state: 'merged', checks: 'failure' });
    expect(await store.getPr('o/r', 3)).toMatchObject({ state: 'merged', checks: 'failure' });
    expect(await store.findOpenPr('o/r', p.branch)).toBeNull();
  });

  it('the snapshot holds open PRs, live runs and jobs, the last day of runs, and default-branch push runs', async () => {
    await store.ensureRepo('o/r', 'main', 'R');
    const open = pr({ number: 1 });
    const merged = pr({ number: 2, state: 'merged' });
    const liveOld = run({ status: 'queued', conclusion: null, completedAt: null, createdAt: minutesAgo(3 * 1440) });
    const recent = run({ createdAt: minutesAgo(600) });
    const oldBranch = run({ createdAt: minutesAgo(3 * 1440) });
    const oldMain = run({ branch: 'main', conclusion: 'failure', createdAt: minutesAgo(3 * 1440) });
    const ancientMain = run({ branch: 'main', createdAt: minutesAgo(20 * 1440) });
    const liveJob = job({ status: 'in_progress', conclusion: null, completedAt: null });
    const doneJob = job();
    for (const p of [open, merged]) await store.upsertPr(p);
    for (const r of [liveOld, recent, oldBranch, oldMain, ancientMain]) await store.upsertRun(r);
    for (const j of [liveJob, doneJob]) await store.upsertJob(j);
    const snap = await store.loadSnapshot(NOW);
    expect(snap.prs.map((p) => p.number)).toEqual([1]);
    expect(snap.runs.map((r) => r.id).sort()).toEqual([liveOld.id, recent.id, oldMain.id].sort());
    expect(snap.jobs.map((j) => j.id)).toEqual([liveJob.id]);
  });

  it('job history is the finished jobs of the last 14 days', async () => {
    const recent = job({ completedAt: minutesAgo(1440) });
    const old = job({ completedAt: minutesAgo(15 * 1440) });
    const live = job({ status: 'in_progress', conclusion: null, completedAt: null });
    for (const j of [recent, old, live]) await store.upsertJob(j);
    expect((await store.loadJobHistory(NOW)).map((j) => j.id)).toEqual([recent.id]);
  });
});

describe('items', () => {
  it('inserts, patches, and keeps resolved items out of the live set', async () => {
    await store.applyItemChanges({ insert: [desired()], update: [] }, NOW);
    const [item] = await store.loadItems();
    expect(item).toMatchObject({
      ...desired(),
      status: 'open',
      firstSeenAt: NOW,
      notifiedAt: null,
      telegramMessageId: null,
      dismissedText: null,
      snoozedUntil: null,
      resolvedAt: null,
    });
    const id = item?.id as string;
    await store.patchItem(id, { status: 'dismissed', dismissedText: 'PR #3 — готов к мержу' });
    expect(await store.getItem(id)).toMatchObject({ status: 'dismissed', dismissedText: 'PR #3 — готов к мержу' });
    await store.applyItemChanges({ insert: [], update: [{ id, patch: { status: 'resolved', resolvedAt: NOW } }] }, NOW);
    expect(await store.loadItems()).toEqual([]);
    expect(await store.getItem(id)).toMatchObject({ status: 'resolved', resolvedAt: NOW });
  });

  it('inserting a key that is already live is ignored, not an error', async () => {
    await store.applyItemChanges({ insert: [desired()], update: [] }, NOW);
    await store.applyItemChanges({ insert: [desired({ text: 'другой текст' })], update: [] }, NOW);
    const items = await store.loadItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('PR #3 — готов к мержу');
  });

  it('a resolved key can live again as a new item', async () => {
    await store.applyItemChanges({ insert: [desired()], update: [] }, NOW);
    const [first] = await store.loadItems();
    await store.patchItem(first?.id as string, { status: 'resolved', resolvedAt: NOW });
    await store.applyItemChanges({ insert: [desired()], update: [] }, NOW);
    const [second] = await store.loadItems();
    expect(second?.id).not.toBe(first?.id);
  });

  it('clearing fields through a patch stores nulls', async () => {
    await store.applyItemChanges({ insert: [desired()], update: [] }, NOW);
    const id = (await store.loadItems())[0]?.id as string;
    await store.patchItem(id, { status: 'snoozed', snoozedUntil: minutesFromNow(60) });
    await store.patchItem(id, { status: 'open', snoozedUntil: null, notifiedAt: null });
    expect(await store.getItem(id)).toMatchObject({ status: 'open', snoozedUntil: null });
  });

  it('only one worker wins the right to notify; the claim lapses after two minutes', async () => {
    await store.applyItemChanges({ insert: [desired()], update: [] }, NOW);
    const id = (await store.loadItems())[0]?.id as string;
    expect(await store.claimNotify([id], NOW)).toBe(true);
    expect(await store.claimNotify([id], minutesFromNow(1))).toBe(false);
    expect(await store.claimNotify([id], minutesFromNow(3))).toBe(true);
  });

  it('a claim over several items is all or nothing', async () => {
    await store.applyItemChanges({ insert: [desired(), desired({ key: 'pr:o/r#4' })], update: [] }, NOW);
    const [a, b] = (await store.loadItems()).map((i) => i.id) as [string, string];
    expect(await store.claimNotify([a], NOW)).toBe(true);
    expect(await store.claimNotify([a, b], NOW)).toBe(false);
    expect(await store.claimNotify([b], NOW)).toBe(true);
  });

  it('markNotified records the time, the message and the text sent', async () => {
    await store.applyItemChanges({ insert: [desired()], update: [] }, NOW);
    const id = (await store.loadItems())[0]?.id as string;
    await store.markNotified([id], NOW, 77, { [id]: 'отправленный текст' });
    expect(await store.getItem(id)).toMatchObject({ notifiedAt: NOW, telegramMessageId: 77, notifiedText: 'отправленный текст' });
  });
});

describe('sources and events', () => {
  it('remembers the last success and the last failure separately', async () => {
    await store.touchSource('github_webhook', minutesAgo(10), true);
    await store.touchSource('github_webhook', minutesAgo(5), false, '3 доставки не прошли');
    expect(await store.getSources()).toEqual([
      { source: 'github_webhook', lastOkAt: minutesAgo(10), lastErrorAt: minutesAgo(5), note: '3 доставки не прошли' },
    ]);
    await store.touchSource('github_webhook', NOW, true);
    expect((await store.getSources())[0]).toMatchObject({ lastOkAt: NOW, lastErrorAt: minutesAgo(5), note: null });
  });

  it('stores the payload as JSON, not as a string that contains JSON', async () => {
    await store.recordEvent('github_webhook', 'd7', { action: 'opened', n: 3 }, NOW);
    const [row] = await sql.query<{ kind: string; action: string }>(
      `select jsonb_typeof(payload) as kind, payload->>'action' as action from events where delivery_id = 'd7'`,
    );
    expect(row).toEqual({ kind: 'object', action: 'opened' });
  });

  it('tells a new delivery from a repeated one, and prunes old ones', async () => {
    expect(await store.recordEvent('github_webhook', 'd1', { a: 1 }, minutesAgo(20 * 1440))).toBe('new');
    expect(await store.recordEvent('github_webhook', 'd1', { a: 1 }, NOW)).toBe('duplicate');
    expect(await store.recordEvent('session_hook', 'd1', {}, NOW)).toBe('new');
    await store.pruneEvents(minutesAgo(14 * 1440));
    expect(await store.recordEvent('github_webhook', 'd1', {}, NOW)).toBe('new');
  });
});
