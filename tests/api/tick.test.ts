import { beforeEach, describe, expect, it } from 'vitest';
import { handleTick, tickIfDue } from '@/lib/api/tick';
import type { GithubApp } from '@/lib/github/app';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW, minutesAgo, pr } from '../helpers/factories';

const TOKEN = 'cron_secret';
let store: PgStore;
let log: string[];
let github: GithubApp;
let failedDeliveries: number;
let drift: number;
let migrations: string[];
let docsError: string | null;
let docsLog: string[];

beforeEach(async () => {
  ({ store } = await testStore());
  log = [];
  failedDeliveries = 0;
  drift = 0;
  migrations = [];
  github = {
    resync: async () => {
      log.push('resync');
      return { drift };
    },
    enrichPr: async () => {},
    cancelRun: async () => {},
    failedDeliveriesSince: async () => failedDeliveries,
    syncDocs: async (_store, _now, opts) => {
      docsLog.push(opts?.all ? 'docs:all' : 'docs');
      if (docsError) throw new Error(docsError);
      return { read: 1, changed: 1 };
    },
  };
  docsError = null;
  docsLog = [];
});

const post = (auth: string | null = `Bearer ${TOKEN}`) =>
  new Request('https://w.example/api/cron/tick', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: '{}' });

const tick = (over: Partial<Parameters<typeof handleTick>[1]> = {}, req = post()) =>
  handleTick(req, {
    store,
    now: NOW,
    token: TOKEN,
    github,
    migrate: async () => migrations,
    recompute: async () => {
      log.push('recompute');
      return { sent: 0, edited: 0, failed: 0 };
    },
    ...over,
  });

describe('tick', () => {
  it('requires the cron token', async () => {
    for (const auth of [null, 'Bearer nope']) {
      const res = await tick({}, post(auth));
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('');
    }
    expect(log).toEqual([]);
  });

  it('applies pending migrations first and reports them', async () => {
    migrations = ['0001_schema', '0002_seed_projects'];
    expect(await (await tick()).json()).toMatchObject({ migrated: ['0001_schema', '0002_seed_projects'], resync: 'ok' });
  });

  it('a failing migration stops the tick with a 500 before anything else runs', async () => {
    const res = await tick({
      migrate: async () => {
        throw new Error('relation "items" already exists');
      },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ migrate: 'relation "items" already exists' });
    expect(log).toEqual([]);
  });

  it('first run: resyncs GitHub, then recomputes, and records the resync as healthy', async () => {
    const res = await tick();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resync: 'ok', recompute: { sent: 0, edited: 0, failed: 0 } });
    expect(log).toEqual(['resync', 'recompute']);
    expect((await store.getSources()).find((s) => s.source === 'github_resync')).toMatchObject({ lastOkAt: NOW });
  });

  it('resyncs again only once the last attempt is 14 minutes old', async () => {
    await store.touchSource('github_resync', minutesAgo(13), true);
    expect(await (await tick()).json()).toMatchObject({ resync: 'skipped' });
    await store.touchSource('github_resync', minutesAgo(14), true);
    expect(await (await tick()).json()).toMatchObject({ resync: 'ok' });
    expect(log).toEqual(['recompute', 'resync', 'recompute']);
  });

  it('a failed attempt also waits 14 minutes before the next one', async () => {
    await store.touchSource('github_resync', minutesAgo(60), true);
    await store.touchSource('github_resync', minutesAgo(5), false, 'boom');
    expect(await (await tick()).json()).toMatchObject({ resync: 'skipped' });
  });

  it('a resync failure is recorded and does not stop the recompute', async () => {
    github.resync = async () => {
      throw new Error('GitHub GET /app/installations → 401 Bad credentials');
    };
    const res = await tick();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resync: 'GitHub GET /app/installations → 401 Bad credentials', recompute: { sent: 0 } });
    expect(log).toEqual(['recompute']);
    expect((await store.getSources()).find((s) => s.source === 'github_resync')).toMatchObject({
      lastOkAt: null,
      lastErrorAt: NOW,
      note: 'GitHub GET /app/installations → 401 Bad credentials',
    });
  });

  it('a recompute failure is reported with a 500, so the scheduler’s log shows it', async () => {
    const res = await tick({
      recompute: async () => {
        throw new Error('db down');
      },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ resync: 'ok', recompute: 'db down' });
  });

  it('flags undelivered webhooks found during the resync', async () => {
    failedDeliveries = 3;
    await tick();
    expect((await store.getSources()).find((s) => s.source === 'github_webhook')).toMatchObject({
      lastErrorAt: NOW,
      note: 'GitHub не смог доставить вебхуков за последний час: 3',
    });
  });

  it('flags webhooks as lost when a resync finds changes no webhook reported', async () => {
    await store.touchSource('github_resync', minutesAgo(20), true);
    await store.touchSource('github_webhook', minutesAgo(300), true);
    drift = 4;
    await tick();
    expect((await store.getSources()).find((s) => s.source === 'github_webhook')).toMatchObject({
      lastErrorAt: NOW,
      note: 'сверка нашла изменения, о которых вебхуки не сообщили: 4',
    });
  });

  it('does not read the very first resync as lost webhooks: everything is new then', async () => {
    drift = 40;
    await tick();
    expect((await store.getSources()).find((s) => s.source === 'github_webhook')).toBeUndefined();
  });

  it('without a configured GitHub App it only recomputes', async () => {
    const res = await tick({ github: null });
    expect(await res.json()).toMatchObject({ resync: 'not configured' });
    expect(log).toEqual(['recompute']);
  });

  it('after a resync, sessions named by PR commits get their project, and old events are pruned', async () => {
    const repo = await store.ensureRepo('o/r', 'main', 'R');
    await store.upsertSession({ id: 'session_x', title: 'x' });
    await store.upsertPr(pr({ sessionId: 'session_x' }));
    await store.recordEvent('github_webhook', 'old', {}, minutesAgo(15 * 1440));
    await tick();
    expect((await store.getSession('session_x'))?.projectId).toBe(repo.projectId);
    expect(await store.recordEvent('github_webhook', 'old', {}, NOW)).toBe('new');
  });
});

describe('heartbeat: the tick that rides on ordinary traffic', () => {
  const beat = (now = NOW) =>
    tickIfDue({
      store,
      now,
      github,
      migrate: async () => migrations,
      recompute: async () => {
        log.push('recompute');
        return { sent: 0, edited: 0, failed: 0 };
      },
    });

  it('runs a full tick when none has run for a minute', async () => {
    expect(await beat()).toBe(true);
    expect(log).toEqual(['resync', 'recompute']);
  });

  it('does nothing within a minute of the last one, however many requests arrive', async () => {
    await beat();
    log = [];
    expect(await beat(new Date(NOW.getTime() + 20_000))).toBe(false);
    expect(await beat(new Date(NOW.getTime() + 59_000))).toBe(false);
    expect(log).toEqual([]);
    expect(await beat(new Date(NOW.getTime() + 61_000))).toBe(true);
    expect(log).toEqual(['recompute']);
  });

  it('a scheduled tick counts as a heartbeat too', async () => {
    await tick();
    log = [];
    expect(await beat(new Date(NOW.getTime() + 30_000))).toBe(false);
  });

  it('never throws: a failing tick must not break the request it rides on', async () => {
    const broken = Object.create(store) as PgStore;
    broken.getSources = async () => {
      throw new Error('db down');
    };
    await expect(
      tickIfDue({ store: broken, now: NOW, github, migrate: async () => [], recompute: async () => ({ sent: 0, edited: 0, failed: 0 }) }),
    ).resolves.toBe(false);
  });

  it('the heartbeat is not shown as a data source of its own', async () => {
    await beat();
    const { buildBoardView } = await import('@/lib/domain/board');
    const snap = await store.loadSnapshot(NOW);
    const view = buildBoardView(snap, [], { running: 0, waiting: 0, freeSlotInMin: 0, rows: [] }, await store.getSources(), NOW, await store.getSettings());
    expect(view.warnings).toEqual([]);
  });
});

describe('tick: project documents', () => {
  it('reads every repository on the first tick and records the source', async () => {
    await store.ensureRepo('o/r', 'main', 'R');
    const res = await tick();
    expect(docsLog).toContain('docs:all');
    expect((await res.json()).docs).toBe('ok');
    expect((await store.getSources()).find((s) => s.source === 'docs_sync')?.lastOkAt).toEqual(NOW);
  });

  it('reads only marked repositories between full reads, and nothing when none is marked', async () => {
    await store.ensureRepo('o/r', 'main', 'R');
    await store.replaceRepoDocs('o/r', [], 'none', minutesAgo(10));
    await store.touchSource('docs_sync', minutesAgo(10), true);
    await tick();
    expect(docsLog).toEqual([]);
    await store.markDocsDirty('o/r');
    await tick();
    expect(docsLog).toEqual(['docs']);
  });

  it('reads everything again half an hour after the last full read', async () => {
    await store.ensureRepo('o/r', 'main', 'R');
    await store.replaceRepoDocs('o/r', [], 'none', minutesAgo(40));
    await store.touchSource('docs_sync', minutesAgo(31), true);
    await tick();
    expect(docsLog).toContain('docs:all');
  });

  it('records a failure and still recomputes', async () => {
    await store.ensureRepo('o/r', 'main', 'R');
    docsError = 'o/r: GitHub 404';
    const res = await tick();
    expect(res.status).toBe(200);
    expect((await res.json()).docs).toContain('404');
    expect(log).toContain('recompute');
    expect((await store.getSources()).find((s) => s.source === 'docs_sync')?.note).toContain('404');
  });
});

describe('tick: project documents come last', () => {
  it('recomputes before reading the docs, so a slow read never delays notifications', async () => {
    await store.ensureRepo('o/r', 'main', 'R');
    const order: string[] = [];
    await tick({
      github: { ...github, syncDocs: async () => (order.push('docs'), { read: 1, changed: 0 }) },
      recompute: async () => (order.push('recompute'), { sent: 0, edited: 0, failed: 0 }),
    });
    expect(order).toEqual(['recompute', 'docs']);
  });
});

describe('tick collects metrics', () => {
  it('runs the collector and answers with its statuses only', async () => {
    const res = await tick({
      metrics: {
        revenuecat: null,
        ads: null,
        appstore: { fetchDay: async (d) => [{ app: '1', source: 'appstore_sales', metric: 'installs', day: d, value: 42, unit: 'count' }] },
      },
    });
    const body = (await res.json()) as { metrics?: Record<string, string> };
    expect(body.metrics).toEqual({ revenuecat: 'not configured', appstore_sales: 'ok', apple_ads: 'not configured' });
    expect(JSON.stringify(body)).not.toContain('42');
    expect((await store.loadMetricDays('2026-01-01')).length).toBeGreaterThan(0);
  });

  it('a tick without metric clients skips them', async () => {
    const body = (await (await tick()).json()) as { metrics?: unknown };
    expect(body.metrics).toBe('not configured');
  });
});
