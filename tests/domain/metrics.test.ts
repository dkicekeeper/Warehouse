import { describe, expect, it } from 'vitest';
import {
  appOwner,
  digestLines,
  summarize,
  trialCostAlerts,
  type MetricDay,
  type MetricName,
  type MetricSource,
} from '@/lib/domain/metrics';
import { NOW } from '../helpers/factories';

// NOW is 2026-11-25: the 7-day period is 18–24 November, the one before it 11–17 November.
const TENRA_APP = '6761530361';
const DALADA_APP = '6817603558';

const SOURCE: Record<MetricName, MetricSource> = {
  installs: 'appstore_sales',
  redownloads: 'appstore_sales',
  ad_impressions: 'apple_ads',
  ad_taps: 'apple_ads',
  ad_installs: 'apple_ads',
  ad_spend: 'apple_ads',
  trials_new: 'revenuecat',
  paid_new: 'revenuecat',
  actives: 'revenuecat',
  mrr: 'revenuecat',
  revenue_net: 'revenuecat',
  revenue_gross: 'revenuecat',
};
const MONEY = new Set<MetricName>(['ad_spend', 'mrr', 'revenue_net', 'revenue_gross']);

function d(app: string, metric: MetricName, day: string, value: number, unit?: string): MetricDay {
  return { app, source: SOURCE[metric], metric, day, value, unit: unit ?? (MONEY.has(metric) ? 'USD' : 'count') };
}

/** The same value on every day from `from` to `to` (inclusive, November). */
function each(app: string, metric: MetricName, from: number, to: number, value: number, unit?: string): MetricDay[] {
  const out: MetricDay[] = [];
  for (let n = from; n <= to; n++) out.push(d(app, metric, `2026-11-${String(n).padStart(2, '0')}`, value, unit));
  return out;
}

const owner = appOwner(
  [
    { id: 'p-tenra', name: 'Tenra', storeUrl: 'https://apps.apple.com/app/id6761530361' },
    { id: 'p-dalada', name: 'Dalada', storeUrl: 'https://apps.apple.com/kz/app/dalada/id6817603558' },
    { id: 'p-platina', name: 'Platina', storeUrl: null },
  ],
  { proj3c40e272: { name: 'Tenra', projectId: null } },
);
const RC = 'rc:proj3c40e272';

describe('appOwner', () => {
  it('finds the project by the App Store id in its passport link', () => {
    expect(owner(TENRA_APP)).toEqual({ projectId: 'p-tenra', name: 'Tenra' });
    expect(owner(DALADA_APP)).toEqual({ projectId: 'p-dalada', name: 'Dalada' });
  });

  it('a RevenueCat project belongs to the Warehouse project of the same name, or to the chosen one', () => {
    expect(owner(RC)).toEqual({ projectId: 'p-tenra', name: 'Tenra' });
    const chosen = appOwner([{ id: 'p-x', name: 'X', storeUrl: null }], { r1: { name: 'Other', projectId: 'p-x' } });
    expect(chosen('rc:r1')).toEqual({ projectId: 'p-x', name: 'X' });
  });

  it('an app no passport links to is «Без проекта»', () => {
    expect(owner('999')).toEqual({ projectId: null, name: 'Без проекта' });
    expect(owner('rc:unknown')).toEqual({ projectId: null, name: 'Без проекта' });
  });
});

describe('summarize', () => {
  const rows = [
    ...each(TENRA_APP, 'installs', 11, 17, 10), // 70 before
    ...each(TENRA_APP, 'installs', 18, 24, 11), // 77 now
    ...each(TENRA_APP, 'redownloads', 18, 24, 1),
    ...each(TENRA_APP, 'ad_installs', 18, 24, 15),
    ...each(TENRA_APP, 'ad_spend', 18, 24, 9),
    d(RC, 'trials_new', '2026-11-20', 2),
    d(RC, 'trials_new', '2026-11-22', 1),
    d(RC, 'actives', '2026-11-23', 4),
    d(RC, 'actives', '2026-11-24', 5),
    d(RC, 'mrr', '2026-11-24', 12.5),
    d(RC, 'revenue_net', '2026-11-21', 13),
    d(RC, 'revenue_gross', '2026-11-21', 20),
    ...each(DALADA_APP, 'installs', 18, 23, 2),
    ...each('424242', 'installs', 18, 24, 1),
  ];
  const [tenra, dalada, orphan] = summarize(rows, owner, 7, NOW);

  it('sums the period that ends yesterday and compares it with the one before', () => {
    expect(tenra.name).toBe('Tenra');
    expect(tenra.installs).toMatchObject({ value: 77, previous: 70 });
    expect(tenra.installs.change).toBeCloseTo(0.1);
    expect(tenra.redownloads.value).toBe(7);
    expect(tenra.trials.value).toBe(3);
  });

  it('actives and MRR are the last day of the period, revenue is the net sum', () => {
    expect(tenra.actives.value).toBe(5);
    expect(tenra.mrr.value).toEqual({ amount: 12.5, currency: 'USD' });
    expect(tenra.revenue).toMatchObject({ value: { amount: 13, currency: 'USD' }, net: true });
  });

  it('without net revenue the gross one is shown, marked so', () => {
    const [p] = summarize([d(RC, 'revenue_gross', '2026-11-21', 20)], owner, 7, NOW);
    expect(p.revenue).toMatchObject({ value: { amount: 20, currency: 'USD' }, net: false });
  });

  it('prices: spend over ad installs, spend over trials, trials over installs', () => {
    expect(tenra.costPerInstall).toEqual({ amount: 63 / 105, currency: 'USD' });
    expect(tenra.costPerTrial).toEqual({ amount: 21, currency: 'USD' });
    expect(tenra.installToTrial).toBeCloseTo(3 / 77);
  });

  it('a product without ads or RevenueCat has no prices, and lists only its sources', () => {
    expect(dalada.sources).toEqual(['appstore_sales']);
    expect(dalada.costPerInstall).toBeNull();
    expect(dalada.costPerTrial).toBeNull();
    expect(dalada.trials.value).toBeNull();
  });

  it('change: new when there was nothing before, null when nothing either time', () => {
    expect(dalada.installs.change).toBe('new');
    expect(tenra.paid).toEqual({ value: 0, previous: 0, change: null });
  });

  it('products are ordered by installs; an unlinked app is kept as «Без проекта»', () => {
    expect(summarize(rows, owner, 7, NOW).map((p) => p.name)).toEqual(['Tenra', 'Dalada', 'Без проекта']);
    expect(orphan).toMatchObject({ projectId: null, installs: { value: 7 } });
  });

  it('says up to which day each source has data', () => {
    expect(dalada.dataUntil).toEqual({ appstore_sales: '2026-11-23' });
    expect(tenra.dataUntil).toMatchObject({ appstore_sales: '2026-11-24', revenuecat: '2026-11-24' });
  });

  it('the daily series covers every day of the period', () => {
    expect(tenra.daily).toHaveLength(7);
    expect(tenra.daily[2]).toEqual({ day: '2026-11-20', installs: 11, trials: 2, adSpend: 9 });
  });

  it('prices are not mixed across currencies: spend in KZT over trials stays KZT', () => {
    const [p] = summarize([...each(TENRA_APP, 'ad_spend', 18, 24, 1000, 'KZT'), d(RC, 'trials_new', '2026-11-20', 2)], owner, 7, NOW);
    expect(p.costPerTrial).toEqual({ amount: 3500, currency: 'KZT' });
  });
});

describe('trialCostAlerts', () => {
  const week = (trials: number, spend: number) =>
    summarize([d(RC, 'trials_new', '2026-11-20', trials), d(TENRA_APP, 'ad_spend', '2026-11-20', spend)], owner, 7, NOW);

  it('a trial dearer than the limit, with at least three trials, is a signal', () => {
    expect(trialCostAlerts(week(3, 62), 15)).toEqual([
      { projectId: 'p-tenra', name: 'Tenra', cost: { amount: 62 / 3, currency: 'USD' } },
    ]);
  });

  it('too few trials or a cheap trial is not', () => {
    expect(trialCostAlerts(week(2, 62), 15)).toEqual([]);
    expect(trialCostAlerts(week(3, 40), 15)).toEqual([]);
  });
});

describe('digestLines', () => {
  it('one line per product for yesterday', () => {
    const rows = [d(TENRA_APP, 'installs', '2026-11-24', 21), d(RC, 'trials_new', '2026-11-24', 1), d(TENRA_APP, 'ad_spend', '2026-11-24', 9)];
    expect(digestLines(rows, owner, NOW)).toEqual(['Tenra: 21 установка, 1 пробный, реклама $9']);
  });

  it('when App Store has not published yesterday yet, the line is about the day before and names it', () => {
    const rows = [d(DALADA_APP, 'installs', '2026-11-23', 18)];
    expect(digestLines(rows, owner, NOW)).toEqual(['Dalada, 23 нояб.: 18 установок']);
  });

  it('a product with no numbers has no line', () => {
    expect(digestLines([], owner, NOW)).toEqual([]);
  });
});
