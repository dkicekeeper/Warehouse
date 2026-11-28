import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchRevenueCat, parseChart, revenuecatKeys } from '@/lib/metrics/revenuecat';

const text = (name: string) => readFileSync(new URL(`../fixtures/metrics/${name}`, import.meta.url), 'utf8');
const PROJECTS = text('rc-projects.json');
const TRIALS = text('rc-chart-trials_new.json');
const REVENUE = text('rc-chart-revenue.json');

describe('parseChart', () => {
  it('turns a daily chart into days of one metric, incomplete days included', () => {
    expect(parseChart(JSON.parse(TRIALS), 'rc:p1', 'trials_new')).toEqual([
      { app: 'rc:p1', source: 'revenuecat', metric: 'trials_new', day: '2026-11-20', value: 2, unit: 'count' },
      { app: 'rc:p1', source: 'revenuecat', metric: 'trials_new', day: '2026-11-21', value: 0, unit: 'count' },
      { app: 'rc:p1', source: 'revenuecat', metric: 'trials_new', day: '2026-11-22', value: 1, unit: 'count' },
    ]);
  });

  it('a money chart takes its money measure and the chart currency', () => {
    expect(parseChart(JSON.parse(REVENUE), 'rc:p1', 'revenue_gross')).toEqual([
      { app: 'rc:p1', source: 'revenuecat', metric: 'revenue_gross', day: '2026-11-20', value: 12.99, unit: 'USD' },
    ]);
  });

  it('reads values given as rows [time, value…] and times in milliseconds too', () => {
    const body = { yaxis_currency: 'USD', measures: [{ unit: '#' }], values: [[1795132800000, 4]] };
    expect(parseChart(body, 'rc:p1', 'actives')).toEqual([
      { app: 'rc:p1', source: 'revenuecat', metric: 'actives', day: '2026-11-20', value: 4, unit: 'count' },
    ]);
  });

  it('a value of null is skipped, not a zero', () => {
    const body = { measures: [{ unit: '#' }], values: [{ cohort: 1795132800, measure: 0, value: null }] };
    expect(parseChart(body, 'rc:p1', 'actives')).toEqual([]);
  });
});

describe('fetchRevenueCat', () => {
  type Call = { url: URL; auth: string | null };
  function fake(calls: Call[], refuse: (u: URL, key: string) => number | null = () => null) {
    return (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const auth = new Headers(init?.headers).get('authorization');
      calls.push({ url: u, auth });
      const code = refuse(u, auth ?? '');
      if (code) return new Response('{"message":"nope secret"}', { status: code });
      if (u.pathname === '/v2/projects') return new Response(PROJECTS);
      if (u.pathname.endsWith('/charts/revenue')) return new Response(REVENUE);
      return new Response(TRIALS);
    }) as unknown as typeof fetch;
  }

  it('reads every project of the key and its six numbers by day', async () => {
    const calls: Call[] = [];
    const [r] = await fetchRevenueCat('sk_1', '2026-11-18', '2026-11-24', fake(calls));
    expect(r).toMatchObject({ project: { id: 'proj3c40e272', name: 'Tenra' } });
    expect(new Set(r!.days.map((d) => d.metric))).toEqual(new Set(['trials_new', 'paid_new', 'actives', 'mrr', 'revenue_gross', 'revenue_net']));
    expect(r!.days.every((d) => d.app === 'rc:proj3c40e272')).toBe(true);
    const chart = calls.find((c) => c.url.pathname === '/v2/projects/proj3c40e272/charts/trials_new')!;
    expect(chart.auth).toBe('Bearer sk_1');
    expect(Object.fromEntries(chart.url.searchParams)).toMatchObject({ resolution: 'day', start_date: '2026-11-18', end_date: '2026-11-24', currency: 'USD' });
    const net = calls.find((c) => c.url.pathname.endsWith('/charts/revenue') && c.url.searchParams.has('selectors'))!;
    expect(JSON.parse(net.url.searchParams.get('selectors')!)).toEqual({ revenue_type: 'proceeds' });
  });

  it('net revenue the chart refuses is left out; the rest still comes', async () => {
    const calls: Call[] = [];
    const [r] = await fetchRevenueCat('sk_1', '2026-11-18', '2026-11-24', fake(calls, (u) => (u.searchParams.has('selectors') ? 400 : null)));
    expect(r!.days.some((d) => d.metric === 'revenue_net')).toBe(false);
    expect(r!.days.some((d) => d.metric === 'revenue_gross')).toBe(true);
  });

  it('a refused key throws with the status, never the body', async () => {
    const calls: Call[] = [];
    const run = () => fetchRevenueCat('sk_bad', '2026-11-18', '2026-11-24', fake(calls, () => 401));
    await expect(run()).rejects.toThrow(/401/);
    await expect(run()).rejects.not.toThrow(/secret/);
  });
});

describe('revenuecatKeys', () => {
  it('takes one or more keys separated by commas', () => {
    expect(revenuecatKeys({ REVENUECAT_API_KEYS: 'sk_a, sk_b,' })).toEqual(['sk_a', 'sk_b']);
    expect(revenuecatKeys({})).toEqual([]);
  });
});
