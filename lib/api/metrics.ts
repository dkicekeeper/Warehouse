import {
  METRIC_SOURCES,
  addDays,
  isoDay,
  ownerFromDocs,
  summarize,
  type KPI,
  type MetricSource,
  type Money,
} from '@/lib/domain/metrics';
import type { Store } from '@/lib/store/store';

export interface MetricsDeps {
  store: Store;
  now: Date;
  isOwner: () => Promise<boolean>;
  /** Which sources have their keys set (the environment says, not the database). */
  configured: Record<MetricSource, boolean>;
}

const empty = (status: number) => new Response(null, { status });
const json = (data: unknown) => Response.json(data, { headers: { 'cache-control': 'no-store' } });

const PERIODS = [7, 28, 90] as const;
type Period = (typeof PERIODS)[number];

/** Spend and revenue of all products, one sum per currency: they are never added across currencies. */
function perCurrency(rows: { metric: string; unit: string; value: number }[], metrics: string[]): Money[] {
  const sums = new Map<string, number>();
  for (const r of rows) if (metrics.includes(r.metric)) sums.set(r.unit, (sums.get(r.unit) ?? 0) + r.value);
  return [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ amount, currency }));
}

/** The metrics page: every product over the period, a total, and the state of each source. */
export async function handleMetrics(req: Request, deps: MetricsDeps): Promise<Response> {
  if (!(await deps.isOwner())) return empty(401);
  const raw = new URL(req.url).searchParams.get('days') ?? '7';
  const days = Number(raw) as Period;
  if (!PERIODS.includes(days)) return empty(400);

  const { store, now } = deps;
  const today = isoDay(now);
  const [snap, docs, sources, settings] = await Promise.all([
    store.loadSnapshot(now),
    store.listDocs().catch(() => []),
    store.getSources(),
    store.getSettings(),
  ]);
  // Right after a deploy the table may not exist yet (the tick creates it): the page still opens.
  const rows = await store.loadMetricDays(addDays(today, -(2 * days + 1))).catch(() => []);
  const owner = ownerFromDocs(snap.projects, snap.repos, docs, settings.revenuecatProjects);
  const products = summarize(rows, owner, days, now);

  const end = addDays(today, -1);
  const start = addDays(end, -(days - 1));
  const inPeriod = rows.filter((r) => r.day >= start && r.day <= end);
  const sum = (field: 'value' | 'previous') =>
    products.some((p) => p.installs[field] !== null) ? products.reduce((a, p) => a + (p.installs[field] ?? 0), 0) : null;
  const now7 = sum('value');
  const before = sum('previous');
  const installs: KPI<number> = {
    value: now7,
    previous: before,
    change: now7 === null || before === null ? null : before === 0 ? (now7 === 0 ? null : 'new') : now7 / before - 1,
  };

  return json({
    days,
    trialCostLimit: settings.metricsTrialCostLimit,
    products,
    total: {
      installs,
      revenue: perCurrency(
        inPeriod,
        products.some((p) => p.revenue.net) ? ['revenue_net'] : ['revenue_gross'],
      ),
      adSpend: perCurrency(inPeriod, ['ad_spend']),
    },
    sources: METRIC_SOURCES.map((source) => {
      const h = sources.find((s) => s.source === source);
      const until = rows.filter((r) => r.source === source && r.day <= end).map((r) => r.day).sort().at(-1) ?? null;
      return {
        source,
        configured: deps.configured[source],
        lastOkAt: h?.lastOkAt?.toISOString() ?? null,
        lastErrorAt: h?.lastErrorAt?.toISOString() ?? null,
        note: h?.note ?? null,
        dataUntil: until,
      };
    }),
  });
}
