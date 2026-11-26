import { beforeEach, describe, expect, it } from 'vitest';
import { handleTick } from '@/lib/api/tick';
import type { GithubApp } from '@/lib/github/app';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW, minutesAgo, pr } from '../helpers/factories';

const TOKEN = 'cron_secret';
let store: PgStore;
let log: string[];
let github: GithubApp;
let failedDeliveries: number;

beforeEach(async () => {
  ({ store } = await testStore());
  log = [];
  failedDeliveries = 0;
  github = {
    resync: async () => {
      log.push('resync');
    },
    enrichPr: async () => {},
    cancelRun: async () => {},
    failedDeliveriesSince: async () => failedDeliveries,
  };
});

const post = (auth: string | null = `Bearer ${TOKEN}`) =>
  new Request('https://w.example/api/cron/tick', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: '{}' });

const tick = (over: Partial<Parameters<typeof handleTick>[1]> = {}, req = post()) =>
  handleTick(req, {
    store,
    now: NOW,
    token: TOKEN,
    github,
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

  it('first run: resyncs GitHub, then recomputes, and records the resync as healthy', async () => {
    const res = await tick();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resync: 'ok', recompute: { sent: 0, edited: 0, failed: 0 } });
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
