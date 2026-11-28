import { beforeEach, describe, expect, it } from 'vitest';
import {
  handleBacklog,
  handleBoard,
  handleCancelRun,
  handleItemAction,
  handleSettingsGet,
  handleSettingsPost,
  nextMorning,
  type OwnerDeps,
} from '@/lib/api/owner-api';
import type { DesiredItem } from '@/lib/domain/attention';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW, job, minutesAgo, minutesFromNow, run, session } from '../helpers/factories';

let store: PgStore;
let cancelled: string[];
let owner: boolean;
beforeEach(async () => {
  ({ store } = await testStore());
  cancelled = [];
  owner = true;
});

const deps = (over: Partial<OwnerDeps> = {}): OwnerDeps => ({
  store,
  now: NOW,
  isOwner: async () => owner,
  github: {
    resync: async () => ({ drift: 0 }),
    enrichPr: async () => {},
    failedDeliveriesSince: async () => 0,
    syncDocs: async () => ({ read: 0, changed: 0 }),
    cancelRun: async (repo, id) => {
      cancelled.push(`${repo}#${id}`);
    },
  },
  ...over,
});

const post = (body: unknown) => new Request('https://w.example/api/x', { method: 'POST', body: JSON.stringify(body) });

const desired = (over: Partial<DesiredItem> = {}): DesiredItem => ({
  key: 'session:session_a',
  kind: 'session_needs_owner',
  level: 'request',
  projectId: null,
  text: 'смержить PR #3',
  sessionId: 'session_a',
  pr: null,
  repo: null,
  since: minutesAgo(10),
  ...over,
});

async function oneItem(): Promise<string> {
  // A real cause behind the item, so a recompute would keep it.
  await store.upsertSession(session({ id: 'session_a', projectId: null, state: 'needs_owner', stateText: 'смержить PR #3' }));
  await store.applyItemChanges({ insert: [desired()], update: [] }, NOW);
  return (await store.loadItems())[0]?.id as string;
}

describe('every owner endpoint refuses anyone else with an empty 401', () => {
  it.each([
    ['board', () => handleBoard(deps())],
    ['backlog', () => handleBacklog(deps())],
    ['item action', () => handleItemAction(post({ action: 'dismiss' }), 'x', deps())],
    ['cancel run', () => handleCancelRun('1', deps())],
    ['settings read', () => handleSettingsGet(deps())],
    ['settings write', () => handleSettingsPost(post({ action: 'update', settings: {} }), deps())],
  ])('%s', async (_n, call) => {
    owner = false;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it('changes nothing for anyone else', async () => {
    const id = await oneItem();
    owner = false;
    await handleItemAction(post({ action: 'dismiss' }), id, deps());
    await handleSettingsPost(post({ action: 'update', settings: { workingTtlMin: 10 } }), deps());
    expect((await store.getItem(id))?.status).toBe('open');
    expect((await store.getSettings()).workingTtlMin).toBe(120);
  });
});

describe('GET /api/board', () => {
  it('returns the board with the mac queue computed from live jobs', async () => {
    await store.ensureRepo('o/r', 'main', 'Tenra');
    const r = run({ status: 'in_progress', conclusion: null, completedAt: null });
    await store.upsertRun(r);
    await store.upsertJob(job({ runId: r.id, status: 'in_progress', conclusion: null, completedAt: null, startedAt: minutesAgo(18) }));
    await store.upsertJob(job({ startedAt: minutesAgo(140), completedAt: minutesAgo(100) }));
    await oneItem();
    const res = await handleBoard(deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const board = await res.json();
    expect(board.generatedAt).toBe(NOW.toISOString());
    expect(board.attention).toMatchObject([{ text: 'смержить PR #3', project: 'Без проекта' }]);
    expect(board.queue).toMatchObject({ running: 1, waiting: 0, rows: [{ project: 'Tenra', elapsedMin: 18, estimateMin: 40 }] });
    expect(board.projects.map((p: { name: string }) => p.name)).toEqual(['Tenra']);
    expect(board.projects[0].sessions).toMatchObject([{ id: 'session_a', state: 'needs_owner' }]);
    // The finished build of the last 14 days counts on its day, under its project.
    expect(board.macBuilds.days).toHaveLength(14);
    expect(board.macBuilds.projects).toEqual(['Tenra']);
    expect(board.macBuilds.days.at(-1).minutes).toEqual({ Tenra: 40 });
  });
});

describe('POST /api/items/:id', () => {
  it('dismiss remembers the dismissed text', async () => {
    const id = await oneItem();
    const res = await handleItemAction(post({ action: 'dismiss' }), id, deps());
    expect(res.status).toBe(204);
    expect(await store.getItem(id)).toMatchObject({ status: 'dismissed', dismissedText: 'смержить PR #3' });
  });

  it('snooze until tomorrow wakes at 08:00 Almaty the next day', async () => {
    const id = await oneItem();
    await handleItemAction(post({ action: 'snooze', until: 'tomorrow' }), id, deps());
    // NOW is 12:00 on 25 Nov in Almaty (UTC+5) → 08:00 on 26 Nov = 03:00 UTC.
    expect(await store.getItem(id)).toMatchObject({ status: 'snoozed', snoozedUntil: new Date('2026-11-26T03:00:00Z') });
  });

  it('snooze for a week wakes seven days later', async () => {
    const id = await oneItem();
    await handleItemAction(post({ action: 'snooze', until: 'week' }), id, deps());
    expect((await store.getItem(id))?.snoozedUntil).toEqual(minutesFromNow(7 * 1440));
  });

  it.each([
    ['an unknown action', { action: 'delete' }],
    ['snooze without a term', { action: 'snooze' }],
    ['snooze until an arbitrary date', { action: 'snooze', until: '2030-01-01' }],
    ['no body', null],
  ])('%s → 400, item untouched', async (_n, body) => {
    const id = await oneItem();
    expect((await handleItemAction(post(body), id, deps())).status).toBe(400);
    expect((await store.getItem(id))?.status).toBe('open');
  });

  it('an unknown or already resolved item → 404', async () => {
    expect((await handleItemAction(post({ action: 'dismiss' }), 'nope', deps())).status).toBe(404);
    const id = await oneItem();
    await store.patchItem(id, { status: 'resolved', resolvedAt: NOW });
    expect((await handleItemAction(post({ action: 'dismiss' }), id, deps())).status).toBe(404);
  });
});

describe('nextMorning', () => {
  it('before 08:00 local it is still the next calendar morning, never today', () => {
    // 03:00 Almaty on 26 Nov → 08:00 on 27 Nov
    expect(nextMorning(new Date('2026-11-25T22:00:00Z'), 'Asia/Almaty')).toEqual(new Date('2026-11-27T03:00:00Z'));
  });
  it('follows the time zone', () => {
    expect(nextMorning(new Date('2026-11-25T12:00:00Z'), 'UTC')).toEqual(new Date('2026-11-26T08:00:00Z'));
  });
});

describe('POST /api/runs/:id/cancel', () => {
  const live = { conclusion: null, completedAt: null };

  it('cancels a queued run through the GitHub App', async () => {
    await store.upsertRun(run({ id: 9002, repo: 'o/r', status: 'queued', ...live }));
    const res = await handleCancelRun('9002', deps());
    expect(res.status).toBe(204);
    expect(cancelled).toEqual(['o/r#9002']);
  });

  it('a running run that nothing newer replaces → 409, nothing sent: the page offers no cancel for it', async () => {
    await store.upsertRun(run({ id: 9003, status: 'in_progress', ...live }));
    expect((await handleCancelRun('9003', deps())).status).toBe(409);
    expect(cancelled).toEqual([]);
  });

  it('a run GitHub calls running but whose mac job still waits for a runner can be cancelled', async () => {
    await store.upsertRun(run({ id: 9006, status: 'in_progress', ...live }));
    await store.upsertJob(job({ id: 96, runId: 9006, status: 'queued', conclusion: null, startedAt: null, completedAt: null }));
    expect((await handleCancelRun('9006', deps())).status).toBe(204);
    expect(cancelled).toEqual(['o/r#9006']);
  });

  it('a running run made stale by a newer push on its branch can be cancelled', async () => {
    await store.upsertRun(run({ id: 9004, status: 'in_progress', headSha: 'old', createdAt: minutesAgo(30), ...live }));
    await store.upsertRun(run({ id: 9005, status: 'queued', headSha: 'new', createdAt: minutesAgo(5), ...live }));
    expect((await handleCancelRun('9004', deps())).status).toBe(204);
    expect(cancelled).toEqual(['o/r#9004']);
  });

  it('a finished run → 409, nothing sent to GitHub', async () => {
    await store.upsertRun(run({ id: 9001 }));
    expect((await handleCancelRun('9001', deps())).status).toBe(409);
    expect(cancelled).toEqual([]);
  });

  it('an unknown run or a non-numeric id → 404', async () => {
    expect((await handleCancelRun('424242', deps())).status).toBe(404);
    expect((await handleCancelRun('abc', deps())).status).toBe(404);
  });

  it('GitHub refusing → 502 with the reason', async () => {
    await store.upsertRun(run({ id: 9002, status: 'queued', ...live }));
    const d = deps();
    d.github!.cancelRun = async () => {
      throw new Error('GitHub POST /repos/o/r/actions/runs/9002/cancel → 409 Cannot cancel a workflow run that is completed');
    };
    const res = await handleCancelRun('9002', d);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: expect.stringContaining('409') });
  });

  it('without a configured GitHub App → 503', async () => {
    await store.upsertRun(run({ id: 9002, status: 'queued', ...live }));
    expect((await handleCancelRun('9002', deps({ github: null }))).status).toBe(503);
  });
});

describe('settings', () => {
  it('read returns settings, projects with their repositories, loose sessions and source health, never a secret', async () => {
    const tenra = await store.ensureRepo('o/Tenra', 'main', 'Tenra');
    await store.upsertSession(session({ id: 'session_loose', projectId: null, repo: null, branch: null, title: 'Otbasy' }));
    await store.upsertSession(session({ id: 'session_in', projectId: tenra.projectId }));
    await store.touchSource('reconcile', minutesAgo(30), true);
    await store.patchSettings({ telegramChatId: '4242' });
    const body = await (await handleSettingsGet(deps())).json();
    expect(body).toEqual({
      settings: {
        workingTtlMin: 120,
        notifyDelayMin: 5,
        quietStart: '23:00',
        quietEnd: '08:00',
        timezone: 'Asia/Almaty',
        macosLimit: null,
        observedMacosLimit: null,
      },
      telegram: { bound: true, linkCode: null },
      projects: [{ id: tenra.projectId, name: 'Tenra', repos: ['o/Tenra'] }],
      looseSessions: [{ id: 'session_loose', title: 'Otbasy' }],
      sources: [{ source: 'reconcile', lastOkAt: minutesAgo(30).toISOString(), lastErrorAt: null, note: null }],
      metrics: { trialCostLimit: 15, inDigest: true, revenuecatProjects: [] },
    });
  });

  it('update changes only what is valid', async () => {
    const res = await handleSettingsPost(
      post({ action: 'update', settings: { workingTtlMin: 90, notifyDelayMin: 0, quietStart: '22:30', quietEnd: '07:00', macosLimit: 2 } }),
      deps(),
    );
    expect(res.status).toBe(204);
    expect(await store.getSettings()).toMatchObject({ workingTtlMin: 90, notifyDelayMin: 0, quietStart: '22:30', quietEnd: '07:00', macosLimit: 2 });
    await handleSettingsPost(post({ action: 'update', settings: { macosLimit: null } }), deps());
    expect((await store.getSettings()).macosLimit).toBeNull();
  });

  it.each([
    ['a TTL under 10 minutes', { workingTtlMin: 9 }],
    ['a TTL over a day', { workingTtlMin: 1441 }],
    ['a delay over an hour', { notifyDelayMin: 61 }],
    ['a time that is not HH:MM', { quietStart: '25:00' }],
    ['a time without leading zero', { quietEnd: '8:00' }],
    ['a limit of zero', { macosLimit: 0 }],
    ['a limit over 50', { macosLimit: 51 }],
    ['a field the owner may not set', { telegramChatId: '1' }],
    ['a fractional number', { workingTtlMin: 90.5 }],
  ])('update rejects %s with 400', async (_n, settings) => {
    expect((await handleSettingsPost(post({ action: 'update', settings }), deps())).status).toBe(400);
    expect(await store.getSettings()).toMatchObject({ workingTtlMin: 120, telegramChatId: null });
  });

  it('metrics: the trial limit and the digest switch are the owner’s to set, within reason', async () => {
    expect((await handleSettingsPost(post({ action: 'update', settings: { metricsTrialCostLimit: 12.5, metricsInDigest: false } }), deps())).status).toBe(204);
    expect(await store.getSettings()).toMatchObject({ metricsTrialCostLimit: 12.5, metricsInDigest: false });
    expect((await handleSettingsPost(post({ action: 'update', settings: { metricsTrialCostLimit: 0 } }), deps())).status).toBe(400);
    expect((await handleSettingsPost(post({ action: 'update', settings: { metricsTrialCostLimit: 100_001 } }), deps())).status).toBe(400);
  });

  it('a RevenueCat project is tied to a Warehouse project, or back to the one of its name', async () => {
    const tenra = await store.ensureRepo('o/Tenra', 'main', 'Tenra');
    await store.patchSettings({ revenuecatProjects: { p1: { name: 'Tenra app', projectId: null } } });
    expect((await handleSettingsPost(post({ action: 'linkRevenueCat', revenuecatId: 'p1', projectId: tenra.projectId }), deps())).status).toBe(204);
    const body = await (await handleSettingsGet(deps())).json();
    expect(body.metrics.revenuecatProjects).toEqual([{ id: 'p1', name: 'Tenra app', projectId: tenra.projectId }]);
    expect((await handleSettingsPost(post({ action: 'linkRevenueCat', revenuecatId: 'p1', projectId: null }), deps())).status).toBe(204);
    expect((await store.getSettings()).revenuecatProjects.p1?.projectId).toBeNull();
    expect((await handleSettingsPost(post({ action: 'linkRevenueCat', revenuecatId: 'nope', projectId: null }), deps())).status).toBe(400);
    expect((await handleSettingsPost(post({ action: 'linkRevenueCat', revenuecatId: 'p1', projectId: 'ghost' }), deps())).status).toBe(400);
  });

  it('linkTelegram issues a one-time code good for 15 minutes', async () => {
    const res = await handleSettingsPost(post({ action: 'linkTelegram' }), deps());
    const { code, expiresAt } = await res.json();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(expiresAt).toBe(minutesFromNow(15).toISOString());
    expect((await store.getSettings()).telegramLinkCode).toEqual({ code, expiresAt: minutesFromNow(15) });
  });

  it('unlinkTelegram forgets the chat', async () => {
    await store.patchSettings({ telegramChatId: '4242' });
    await handleSettingsPost(post({ action: 'unlinkTelegram' }), deps());
    expect((await store.getSettings()).telegramChatId).toBeNull();
  });

  it('renameProject, moveRepo and assignSession arrange the projects', async () => {
    const tenra = await store.ensureRepo('o/Tenra', 'main', 'Tenra');
    await store.ensureRepo('o/tenra-assets', 'main', 'tenra-assets');
    await store.upsertSession({ id: 'session_loose', title: 'Otbasy' });
    for (const body of [
      { action: 'renameProject', projectId: tenra.projectId, name: '  Tenra iOS  ' },
      { action: 'moveRepo', repo: 'o/tenra-assets', projectId: tenra.projectId },
      { action: 'assignSession', sessionId: 'session_loose', projectId: tenra.projectId },
    ]) {
      expect((await handleSettingsPost(post(body), deps())).status).toBe(204);
    }
    const snap = await store.loadSnapshot(NOW);
    expect(snap.projects).toEqual([{ id: tenra.projectId, name: 'Tenra iOS' }]);
    expect((await store.getSession('session_loose'))?.projectId).toBe(tenra.projectId);
  });

  it('rejects an empty project name, an unknown project, and an unknown action', async () => {
    const tenra = await store.ensureRepo('o/Tenra', 'main', 'Tenra');
    expect((await handleSettingsPost(post({ action: 'renameProject', projectId: tenra.projectId, name: '   ' }), deps())).status).toBe(400);
    expect((await handleSettingsPost(post({ action: 'moveRepo', repo: 'o/Tenra', projectId: 'ghost' }), deps())).status).toBe(400);
    expect((await handleSettingsPost(post({ action: 'assignSession', sessionId: 's', projectId: 'ghost' }), deps())).status).toBe(400);
    expect((await handleSettingsPost(post({ action: 'dropDatabase' }), deps())).status).toBe(400);
  });
});

describe('backlog', () => {
  const task = {
    repo: 'dkicekeeper/Platina', path: 'docs/backlog/2026-11-26-device-check.md', kind: 'task' as const, id: '2026-11-26-device-check',
    title: 'Проверка на устройстве', status: 'blocked', fields: { status: 'blocked', priority: 1, 'needs-owner': 'проверить на iPhone' },
    body: 'Зачем: видно только на телефоне.', blobSha: 'a',
  };

  it('returns the records of the projects and when they were last read', async () => {
    await store.ensureRepo('dkicekeeper/Platina', 'main', 'Platina');
    await store.replaceRepoDocs('dkicekeeper/Platina', [task], 't1', minutesAgo(3));
    const res = await handleBacklog(deps());
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.projects).toHaveLength(1);
    expect(view.projects[0]).toMatchObject({ name: 'Platina', counts: { open: 1, needsOwner: 1 } });
    expect(view.ownerTasks[0]).toMatchObject({ title: 'Проверка на устройстве', needsOwner: 'проверить на iPhone' });
    expect(view.syncedAt).toBe(minutesAgo(3).toISOString());
  });

  it('puts the owner tasks and the counts of each project on the board', async () => {
    const repo = await store.ensureRepo('dkicekeeper/Platina', 'main', 'Platina');
    await store.replaceRepoDocs('dkicekeeper/Platina', [task], 't1', NOW);
    const board = await (await handleBoard(deps())).json();
    expect(board.backlog.ownerTasks).toHaveLength(1);
    expect(board.backlog.byProject[repo.projectId]).toMatchObject({ open: 1, needsOwner: 1, stage: null });
  });

  it('is empty before anything was read', async () => {
    const view = await (await handleBacklog(deps())).json();
    expect(view).toMatchObject({ projects: [], ownerTasks: [], syncedAt: null });
  });
});

describe('before the migration has run', () => {
  const noTable = () => Promise.reject(new Error('relation "project_docs" does not exist'));

  it('the board still answers, without backlog data', async () => {
    const broken = Object.assign(Object.create(store), { listDocs: noTable }) as PgStore;
    const res = await handleBoard(deps({ store: broken }));
    expect(res.status).toBe(200);
    expect((await res.json()).backlog).toEqual({ ownerTasks: [], byProject: {} });
  });

  it('the backlog answers empty', async () => {
    const broken = Object.assign(Object.create(store), { listDocs: noTable, listDocsState: noTable }) as PgStore;
    const res = await handleBacklog(deps({ store: broken }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ projects: [], syncedAt: null });
  });
});
