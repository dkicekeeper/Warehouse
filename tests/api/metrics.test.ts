import { beforeEach, describe, expect, it } from 'vitest';
import { handleMetrics, type MetricsDeps } from '@/lib/api/metrics';
import type { MetricDay } from '@/lib/domain/metrics';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW } from '../helpers/factories';

let store: PgStore;
let owner: boolean;
beforeEach(async () => {
  ({ store } = await testStore());
  owner = true;
});

const deps = (over: Partial<MetricsDeps> = {}): MetricsDeps => ({
  store,
  now: NOW,
  isOwner: async () => owner,
  configured: { revenuecat: true, appstore_sales: true, apple_ads: false },
  ...over,
});
const get = (days = '7') => new Request(`https://w.example/api/metrics?days=${days}`);
const row = (app: string, metric: MetricDay['metric'], source: MetricDay['source'], value: number, day = '2026-11-20'): MetricDay => ({
  app, source, metric, day, value, unit: metric === 'ad_spend' ? 'USD' : 'count',
});

describe('GET /api/metrics', () => {
  it('only to the owner', async () => {
    owner = false;
    expect((await handleMetrics(get(), deps())).status).toBe(401);
  });

  it('only for 7, 28 or 90 days', async () => {
    expect((await handleMetrics(get('30'), deps())).status).toBe(400);
    expect((await handleMetrics(new Request('https://w.example/api/metrics'), deps())).status).toBe(200);
  });

  it('the products with their numbers, the app no passport links to as «Без проекта», and a total', async () => {
    await store.ensureRepo('dkicekeeper/Tenra', 'main', 'Tenra');
    await store.replaceRepoDocs(
      'dkicekeeper/Tenra',
      [{ repo: 'dkicekeeper/Tenra', path: 'docs/project.md', kind: 'project', id: 'project', title: 'Tenra', status: 'live', fields: { links: { store: 'https://apps.apple.com/app/id6761530361' } }, body: '', blobSha: 'a' }],
      't1',
      NOW,
    );
    await store.upsertMetricDays([row('6761530361', 'installs', 'appstore_sales', 30), row('424242', 'installs', 'appstore_sales', 2)]);
    await store.touchSource('appstore_sales', NOW, true);
    const res = await handleMetrics(get('28'), deps());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: number;
      products: { name: string; installs: { value: number } }[];
      total: { installs: { value: number } };
      sources: { source: string; configured: boolean; lastOkAt: string | null; dataUntil: string | null }[];
    };
    expect(body.days).toBe(28);
    expect((body as unknown as { trialCostLimit: number }).trialCostLimit).toBe(15);
    expect(body.products.map((p) => [p.name, p.installs.value])).toEqual([['Tenra', 30], ['Без проекта', 2]]);
    expect(body.total.installs.value).toBe(32);
    expect(body.sources).toEqual([
      expect.objectContaining({ source: 'revenuecat', configured: true, lastOkAt: null, dataUntil: null }),
      expect.objectContaining({ source: 'appstore_sales', configured: true, lastOkAt: NOW.toISOString(), dataUntil: '2026-11-20' }),
      expect.objectContaining({ source: 'apple_ads', configured: false }),
    ]);
  });

  it('spend in two currencies is not added up into one number', async () => {
    await store.upsertMetricDays([row('1', 'ad_spend', 'apple_ads', 5), { ...row('2', 'ad_spend', 'apple_ads', 1000), unit: 'KZT' }]);
    const body = (await (await handleMetrics(get(), deps())).json()) as { total: { adSpend: { amount: number; currency: string }[] } };
    expect(body.total.adSpend).toEqual([{ amount: 1000, currency: 'KZT' }, { amount: 5, currency: 'USD' }]);
  });
});
