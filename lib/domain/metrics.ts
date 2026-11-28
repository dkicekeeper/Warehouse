import { plural } from '@/components/format';

/**
 * Metrics: the numbers each source gives per app and day, and what the page, the signals and the
 * morning digest make of them. Pure functions; the store keeps `MetricDay` rows, one per app,
 * source, metric and day.
 */

export type MetricSource = 'revenuecat' | 'appstore_sales' | 'apple_ads';
export type MetricName =
  | 'installs'
  | 'redownloads'
  | 'ad_impressions'
  | 'ad_taps'
  | 'ad_installs'
  | 'ad_spend'
  | 'trials_new'
  | 'paid_new'
  | 'actives'
  | 'mrr'
  | 'revenue_net'
  | 'revenue_gross';

export const METRIC_SOURCES: MetricSource[] = ['revenuecat', 'appstore_sales', 'apple_ads'];

export interface MetricDay {
  /** App Store id of the app (digits), or `rc:<RevenueCat project id>`. */
  app: string;
  source: MetricSource;
  metric: MetricName;
  /** YYYY-MM-DD, UTC. */
  day: string;
  value: number;
  /** `count`, or an ISO currency code. */
  unit: string;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface KPI<T = number | Money> {
  /** Null: the product has no source for this number. */
  value: T | null;
  previous: T | null;
  /** Share of change, 0.12 = +12 %; 'new' when there was nothing before; null when nothing either time. */
  change: number | 'new' | null;
}

export interface ProductMetrics {
  projectId: string | null;
  name: string;
  sources: MetricSource[];
  installs: KPI<number>;
  redownloads: KPI<number>;
  adInstalls: KPI<number>;
  trials: KPI<number>;
  paid: KPI<number>;
  actives: KPI<number>;
  mrr: KPI<Money>;
  revenue: KPI<Money> & { net: boolean };
  adSpend: KPI<Money>;
  costPerInstall: Money | null;
  costPerTrial: Money | null;
  installToTrial: number | null;
  daily: { day: string; installs: number; trials: number; adSpend: number }[];
  dataUntil: Partial<Record<MetricSource, string>>;
}

/** RevenueCat projects as the settings know them: the name RevenueCat gives, and the project chosen for it. */
export type RevenueCatProjects = Record<string, { name: string; projectId: string | null }>;

export type Owner = (app: string) => { projectId: string | null; name: string };

const NO_PROJECT = 'Без проекта';
const DAY = 86_400_000;

/** YYYY-MM-DD of a moment, UTC. */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));

/** The App Store id a store link carries: the number after `/id`. */
export const storeAppId = (url: string | null): string | null => url?.match(/\/id(\d+)/)?.[1] ?? null;

export function appOwner(projects: { id: string; name: string; storeUrl: string | null }[], rcProjects: RevenueCatProjects): Owner {
  const byApp = new Map<string, { id: string; name: string }>();
  for (const p of projects) {
    const id = storeAppId(p.storeUrl);
    if (id) byApp.set(id, p);
  }
  const byId = new Map(projects.map((p) => [p.id, p]));
  const byName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
  return (app) => {
    let p: { id: string; name: string } | undefined;
    if (app.startsWith('rc:')) {
      const rc = rcProjects[app.slice(3)];
      p = rc ? ((rc.projectId ? byId.get(rc.projectId) : undefined) ?? byName.get(rc.name.toLowerCase())) : undefined;
    } else {
      p = byApp.get(app);
    }
    return p ? { projectId: p.id, name: p.name } : { projectId: null, name: NO_PROJECT };
  };
}

function change(now: number | null, before: number | null): number | 'new' | null {
  if (now === null || before === null) return null;
  if (before === 0) return now === 0 ? null : 'new';
  return now / before - 1;
}

const kpi = (now: number | null, before: number | null): KPI<number> => ({ value: now, previous: before, change: change(now, before) });

function moneyKpi(now: number | null, before: number | null, currency: string): KPI<Money> {
  const m = (v: number | null) => (v === null ? null : { amount: v, currency });
  return { value: m(now), previous: m(before), change: change(now, before) };
}

/** Counts and sums are added up over the period; actives and MRR are what the last day says. */
const LEVELS = new Set<MetricName>(['actives', 'mrr']);

export function summarize(rows: MetricDay[], owner: Owner, days: 7 | 28 | 90, today: Date): ProductMetrics[] {
  const end = addDays(isoDay(today), -1);
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));

  const groups = new Map<string, { projectId: string | null; name: string; rows: MetricDay[] }>();
  for (const r of rows) {
    // Apps without a project share one «Без проекта» block.
    const o = owner(r.app);
    const key = o.projectId ?? NO_PROJECT;
    const g = groups.get(key) ?? { ...o, rows: [] };
    groups.set(key, g);
    g.rows.push(r);
  }

  const out: ProductMetrics[] = [];
  for (const g of groups.values()) {
    const sources = METRIC_SOURCES.filter((s) => g.rows.some((r) => r.source === s));
    const has = (s: MetricSource) => sources.includes(s);
    const within = (from: string, to: string) => g.rows.filter((r) => r.day >= from && r.day <= to);
    const cur = within(start, end);
    const prev = within(prevStart, prevEnd);

    const total = (set: MetricDay[], m: MetricName): number => set.filter((r) => r.metric === m).reduce((a, r) => a + r.value, 0);
    const level = (set: MetricDay[], m: MetricName): number => {
      const last = set.filter((r) => r.metric === m).sort((a, b) => a.day.localeCompare(b.day)).at(-1);
      return last?.value ?? 0;
    };
    const pick = (set: MetricDay[], m: MetricName) => (LEVELS.has(m) ? level(set, m) : total(set, m));
    const metricOf = (s: MetricSource, m: MetricName) => kpi(has(s) ? pick(cur, m) : null, has(s) ? pick(prev, m) : null);
    const unitOf = (m: MetricName) => g.rows.find((r) => r.metric === m)?.unit ?? 'USD';
    const moneyOf = (s: MetricSource, m: MetricName) => {
      const k = metricOf(s, m);
      return moneyKpi(k.value, k.previous, unitOf(m));
    };

    const installs = metricOf('appstore_sales', 'installs');
    const adInstalls = metricOf('apple_ads', 'ad_installs');
    const trials = metricOf('revenuecat', 'trials_new');
    const adSpend = moneyOf('apple_ads', 'ad_spend');
    const net = g.rows.some((r) => r.metric === 'revenue_net');
    const revenue = { ...moneyOf('revenuecat', net ? 'revenue_net' : 'revenue_gross'), net };

    const per = (spend: Money | null, n: number | null): Money | null =>
      spend && n ? { amount: spend.amount / n, currency: spend.currency } : null;

    const daily: ProductMetrics['daily'] = [];
    for (let day = start; day <= end; day = addDays(day, 1)) {
      const of = (m: MetricName) => g.rows.filter((r) => r.day === day && r.metric === m).reduce((a, r) => a + r.value, 0);
      daily.push({ day, installs: of('installs'), trials: of('trials_new'), adSpend: of('ad_spend') });
    }

    const dataUntil: Partial<Record<MetricSource, string>> = {};
    for (const s of sources) {
      const last = g.rows.filter((r) => r.source === s && r.day <= end).map((r) => r.day).sort().at(-1);
      if (last) dataUntil[s] = last;
    }

    out.push({
      projectId: g.projectId,
      name: g.name,
      sources,
      installs,
      redownloads: metricOf('appstore_sales', 'redownloads'),
      adInstalls,
      trials,
      paid: metricOf('revenuecat', 'paid_new'),
      actives: metricOf('revenuecat', 'actives'),
      mrr: moneyOf('revenuecat', 'mrr'),
      revenue,
      adSpend,
      costPerInstall: per(adSpend.value, adInstalls.value),
      costPerTrial: has('revenuecat') ? per(adSpend.value, trials.value) : null,
      installToTrial: installs.value && trials.value !== null ? trials.value / installs.value : null,
      daily,
      dataUntil,
    });
  }
  return out.sort((a, b) => (b.installs.value ?? 0) - (a.installs.value ?? 0));
}

/** Fewer trials than this in the week say too little about their price to raise a signal. */
const ALERT_MIN_TRIALS = 3;

/** Products whose trial over the last 7 days cost more than the limit. `products` is a 7-day summary. */
export function trialCostAlerts(products: ProductMetrics[], limit: number): { projectId: string | null; name: string; cost: Money }[] {
  return products
    .filter((p) => p.costPerTrial && (p.trials.value ?? 0) >= ALERT_MIN_TRIALS && p.costPerTrial.amount > limit)
    .map((p) => ({ projectId: p.projectId, name: p.name, cost: p.costPerTrial as Money }));
}

/** «$9», «$20,7», «1 500 KZT». */
export function formatMoney(m: Money): string {
  const n = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: Math.abs(m.amount) < 100 ? 2 : 0 }).format(m.amount);
  return m.currency === 'USD' ? `$${n.replace(/\s/g, ' ')}` : `${n.replace(/\s/g, ' ')} ${m.currency}`;
}

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * The morning digest's numbers: a line per product for yesterday. App Store publishes a day's sales
 * by the next morning in California, after the digest; a product whose sales for yesterday are not
 * there yet gets the day before, named.
 */
export function digestLines(rows: MetricDay[], owner: Owner, today: Date): string[] {
  const yesterday = addDays(isoDay(today), -1);
  const before = addDays(yesterday, -1);
  const groups = new Map<string, { name: string; rows: MetricDay[] }>();
  for (const r of rows) {
    if (r.day !== yesterday && r.day !== before) continue;
    const o = owner(r.app);
    const key = o.projectId ?? NO_PROJECT;
    const g = groups.get(key) ?? { name: o.name, rows: [] };
    groups.set(key, g);
    g.rows.push(r);
  }

  const lines: string[] = [];
  for (const g of groups.values()) {
    const sales = g.rows.some((r) => r.source === 'appstore_sales');
    const day = !sales || g.rows.some((r) => r.source === 'appstore_sales' && r.day === yesterday) ? yesterday : before;
    const of = (m: MetricName) => g.rows.filter((r) => r.day === day && r.metric === m);
    const sum = (m: MetricName) => of(m).reduce((a, r) => a + r.value, 0);
    const has = (s: MetricSource) => g.rows.some((r) => r.source === s && r.day === day);

    const parts: string[] = [];
    if (has('appstore_sales')) parts.push(plural(sum('installs'), ['установка', 'установки', 'установок']));
    if (has('revenuecat')) parts.push(plural(sum('trials_new'), ['пробный', 'пробных', 'пробных']));
    if (has('apple_ads')) parts.push(`реклама ${formatMoney({ amount: sum('ad_spend'), currency: of('ad_spend')[0]?.unit ?? 'USD' })}`);
    if (parts.length === 0) continue;
    lines.push(`${g.name}${day === yesterday ? '' : `, ${shortDate(day)}`}: ${parts.join(', ')}`);
  }
  return lines;
}
