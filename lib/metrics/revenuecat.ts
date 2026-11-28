import type { MetricDay, MetricName } from '@/lib/domain/metrics';
import { SourceError } from './jwt';

/** RevenueCat API v2 charts: trials, paid subscriptions, actives, MRR and revenue per project and day. */

export function revenuecatKeys(env: Record<string, string | undefined>): string[] {
  return (env.REVENUECAT_API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
}

const API = 'https://api.revenuecat.com/v2';
const CURRENCY = 'USD';

/** Which chart gives which metric; `selectors` picks a variant of a chart. */
const CHARTS: { chart: string; metric: MetricName; selectors?: Record<string, string>; optional?: boolean }[] = [
  { chart: 'trials_new', metric: 'trials_new' },
  { chart: 'actives_new', metric: 'paid_new' },
  { chart: 'actives', metric: 'actives' },
  { chart: 'mrr', metric: 'mrr' },
  { chart: 'revenue', metric: 'revenue_gross' },
  // Revenue after the store's cut and taxes; a project or plan without it simply has none.
  { chart: 'revenue', metric: 'revenue_net', selectors: { revenue_type: 'proceeds' }, optional: true },
];

const MONEY = new Set<MetricName>(['mrr', 'revenue_gross', 'revenue_net']);

interface ChartBody {
  yaxis_currency?: string;
  measures?: { unit?: string }[];
  values?: unknown[];
}

const dayOf = (t: number) => new Date(t > 1e12 ? t : t * 1000).toISOString().slice(0, 10);

/**
 * A chart's daily values as days of one metric. A money metric reads the chart's first money
 * measure (the revenue chart also counts transactions); a count, its first measure. Values come
 * as `{cohort, measure, value}` or as rows `[time, value of measure 0, …]`.
 */
export function parseChart(body: unknown, app: string, metric: MetricName): MetricDay[] {
  const b = (body ?? {}) as ChartBody;
  const measures = b.measures ?? [];
  const money = MONEY.has(metric);
  const found = measures.findIndex((m) => (money ? m.unit === '$' : m.unit !== '$'));
  const measure = found < 0 ? 0 : found;
  const unit = money ? (b.yaxis_currency ?? CURRENCY) : 'count';
  const byDay = new Map<string, number>();
  for (const v of b.values ?? []) {
    let time: number | undefined;
    let value: unknown;
    if (Array.isArray(v)) {
      time = Number(v[0]);
      value = v[measure + 1];
    } else if (v && typeof v === 'object') {
      const o = v as { cohort?: number; measure?: number; value?: unknown };
      if ((o.measure ?? 0) !== measure) continue;
      time = Number(o.cohort);
      value = o.value;
    }
    if (time === undefined || !Number.isFinite(time) || value === null || value === undefined || !Number.isFinite(Number(value))) continue;
    byDay.set(dayOf(time), Number(value));
  }
  return [...byDay].map(([day, value]) => ({ app, source: 'revenuecat' as const, metric, day, value, unit }));
}

/** The key's projects and their days `from` to `to` (inclusive, UTC). */
export async function fetchRevenueCat(
  key: string,
  from: string,
  to: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ project: { id: string; name: string }; days: MetricDay[] }[]> {
  const get = async (path: string, params?: Record<string, string>) => {
    const q = params ? `?${new URLSearchParams(params)}` : '';
    const res = await fetchFn(`${API}${path}${q}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new SourceError(res.status, `RevenueCat ${path.replace(/projects\/[^/]+/, 'projects/…')}`);
    return res.json() as Promise<unknown>;
  };

  const list = (await get('/projects')) as { items?: { id?: unknown; name?: unknown }[] };
  const out: { project: { id: string; name: string }; days: MetricDay[] }[] = [];
  for (const p of list.items ?? []) {
    const project = { id: String(p.id), name: String(p.name ?? p.id) };
    const days: MetricDay[] = [];
    for (const c of CHARTS) {
      const params: Record<string, string> = { resolution: 'day', start_date: from, end_date: to, currency: CURRENCY };
      if (c.selectors) params.selectors = JSON.stringify(c.selectors);
      try {
        days.push(...parseChart(await get(`/projects/${encodeURIComponent(project.id)}/charts/${c.chart}`, params), `rc:${project.id}`, c.metric));
      } catch (err) {
        if (c.optional && err instanceof SourceError && err.status === 400) continue;
        throw err;
      }
    }
    out.push({ project, days });
  }
  return out;
}
