import { beforeEach, describe, expect, it } from 'vitest';
import type { MetricDay } from '@/lib/domain/metrics';
import { collectMetrics, type MetricClients } from '@/lib/metrics/collect';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW } from '../helpers/factories';

// NOW is 2026-11-25 07:00 UTC: yesterday is 24 November, 180 days back is 29 May.
let store: PgStore;
let asked: { source: string; from: string; to: string }[];
let salesDays: string[];

const day = (source: MetricDay['source'], app: string, d: string, metric: MetricDay['metric'], value = 1): MetricDay => ({
  app, source, metric, day: d, value, unit: 'count',
});

function clients(over: Partial<MetricClients> = {}): MetricClients {
  return {
    revenuecat: {
      keys: ['sk_a'],
      fetch: async (key, from, to) => {
        asked.push({ source: 'revenuecat', from, to });
        return [{ project: { id: 'p1', name: 'Tenra' }, days: [day('revenuecat', 'rc:p1', to, 'trials_new')] }];
      },
    },
    appstore: {
      fetchDay: async (d) => {
        salesDays.push(d);
        return d >= '2026-11-24' ? 'not_yet' : [day('appstore_sales', '6761530361', d, 'installs', 3)];
      },
    },
    ads: {
      fetch: async (from, to) => {
        asked.push({ source: 'apple_ads', from, to });
        return [day('apple_ads', '6761530361', to, 'ad_taps')];
      },
    },
    ...over,
  };
}

beforeEach(async () => {
  ({ store } = await testStore());
  asked = [];
  salesDays = [];
});

describe('collectMetrics', () => {
  it('the first collection reads 180 days of RevenueCat and Apple Ads', async () => {
    const out = await collectMetrics(store, NOW, clients());
    expect(out).toMatchObject({ revenuecat: 'ok', apple_ads: 'ok' });
    expect(asked).toEqual([
      { source: 'revenuecat', from: '2026-05-29', to: '2026-11-24' },
      { source: 'apple_ads', from: '2026-05-29', to: '2026-11-24' },
    ]);
    expect((await store.loadMetricDays('2026-01-01')).length).toBeGreaterThan(0);
  });

  it('sales: the last 7 days, then back towards 180 days, 15 reports a tick, continuing where it stopped', async () => {
    await collectMetrics(store, NOW, clients());
    expect(salesDays).toHaveLength(15);
    expect(salesDays.slice(0, 7)).toEqual(['2026-11-24', '2026-11-23', '2026-11-22', '2026-11-21', '2026-11-20', '2026-11-19', '2026-11-18']);
    expect(salesDays.at(-1)).toBe('2026-11-10');
    salesDays = [];
    await collectMetrics(store, new Date(NOW.getTime() + 60_000), clients());
    expect(salesDays[0]).toBe('2026-11-09');
    expect(salesDays).toHaveLength(15);
  });

  it('a sales failure halfway keeps the days already read, and the next try starts after them', async () => {
    let calls = 0;
    const flaky = clients({
      appstore: {
        fetchDay: async (d) => {
          salesDays.push(d);
          if (++calls === 10) throw new Error('App Store Connect salesReports: HTTP 500');
          return [day('appstore_sales', '6761530361', d, 'installs', 3)];
        },
      },
    });
    expect((await collectMetrics(store, NOW, flaky)).appstore_sales).toMatch(/500/);
    expect(await store.getMetricBackfill('appstore_sales')).toBe('2026-11-16');
    salesDays = [];
    await collectMetrics(store, new Date(NOW.getTime() + 61 * 60_000), flaky);
    expect(salesDays.slice(0, 8)).toContain('2026-11-15');
    expect(salesDays).not.toContain('2026-11-16');
  });

  it('a day Apple has not published yet is not a failure', async () => {
    const out = await collectMetrics(store, NOW, clients());
    expect(out.appstore_sales).toBe('ok');
    expect((await store.getSources()).find((s) => s.source === 'appstore_sales')).toMatchObject({ lastOkAt: NOW });
  });

  it('collected today: the next tick skips RevenueCat and Apple Ads; a day later it reads the last 7 days again', async () => {
    await collectMetrics(store, NOW, clients());
    asked = [];
    const later = await collectMetrics(store, new Date(NOW.getTime() + 3600_000), clients());
    expect(later).toMatchObject({ revenuecat: 'skipped', apple_ads: 'skipped' });
    expect(asked).toEqual([]);
    await collectMetrics(store, new Date(NOW.getTime() + 25 * 3600_000), clients());
    expect(asked).toEqual([
      { source: 'revenuecat', from: '2026-11-19', to: '2026-11-25' },
      { source: 'apple_ads', from: '2026-11-19', to: '2026-11-25' },
    ]);
  });

  it('one failing source is recorded and does not stop the others; it is tried again after an hour, not every tick', async () => {
    const broken = clients({ ads: { fetch: async () => Promise.reject(new Error('Apple Ads token: HTTP 401')) } });
    const out = await collectMetrics(store, NOW, broken);
    expect(out).toMatchObject({ apple_ads: 'Apple Ads token: HTTP 401', revenuecat: 'ok', appstore_sales: 'ok' });
    expect((await store.getSources()).find((s) => s.source === 'apple_ads')).toMatchObject({ lastErrorAt: NOW, note: 'Apple Ads token: HTTP 401' });
    expect((await collectMetrics(store, new Date(NOW.getTime() + 10 * 60_000), broken)).apple_ads).toBe('skipped');
    expect((await collectMetrics(store, new Date(NOW.getTime() + 61 * 60_000), broken)).apple_ads).toBe('Apple Ads token: HTTP 401');
  });

  it('a failing RevenueCat key does not cost the other key its numbers', async () => {
    const two = clients({
      revenuecat: {
        keys: ['sk_bad', 'sk_good'],
        fetch: async (key, from, to) => {
          if (key === 'sk_bad') throw new Error('RevenueCat /projects: HTTP 401');
          return [{ project: { id: 'p2', name: 'Dalada' }, days: [day('revenuecat', 'rc:p2', to, 'trials_new')] }];
        },
      },
    });
    const out = await collectMetrics(store, NOW, two);
    expect(out.revenuecat).toMatch(/401/);
    expect((await store.loadMetricDays('2026-01-01')).some((r) => r.app === 'rc:p2')).toBe(true);
  });

  it('remembers RevenueCat project names, keeping the project the owner chose', async () => {
    await store.patchSettings({ revenuecatProjects: { p1: { name: 'Old name', projectId: 'chosen' } } });
    await collectMetrics(store, NOW, clients());
    expect((await store.getSettings()).revenuecatProjects).toEqual({ p1: { name: 'Tenra', projectId: 'chosen' } });
  });

  it('a source without keys is «not configured» and never asked', async () => {
    const out = await collectMetrics(store, NOW, { revenuecat: null, appstore: null, ads: null });
    expect(out).toEqual({ revenuecat: 'not configured', appstore_sales: 'not configured', apple_ads: 'not configured' });
    expect(await store.getSources()).toEqual([]);
  });

  it('the result carries statuses only, never the numbers', async () => {
    const out = await collectMetrics(store, NOW, clients());
    expect(JSON.stringify(out)).not.toMatch(/\d{4}-\d{2}-\d{2}|installs|trials/);
  });
});
