import { addDays, isoDay, type MetricDay, type MetricSource } from '@/lib/domain/metrics';
import type { Store } from '@/lib/store/store';
import { adsConfig, fetchAdsDays } from './apple-ads';
import { appStoreConfig, fetchSalesDay } from './appstore';
import { fetchRevenueCat, revenuecatKeys } from './revenuecat';

/** What the collector needs from the sources; null for a source without keys. */
export interface MetricClients {
  revenuecat: { keys: string[]; fetch: (key: string, from: string, to: string) => ReturnType<typeof fetchRevenueCat> } | null;
  appstore: { fetchDay: (day: string) => Promise<MetricDay[] | 'not_yet'> } | null;
  ads: { fetch: (from: string, to: string) => Promise<MetricDay[]> } | null;
}

/** The clients the environment has keys for. */
export function metricClients(env: Record<string, string | undefined> = process.env): MetricClients {
  const keys = revenuecatKeys(env);
  const asc = appStoreConfig(env);
  const ads = adsConfig(env);
  return {
    revenuecat: keys.length > 0 ? { keys, fetch: (key, from, to) => fetchRevenueCat(key, from, to) } : null,
    appstore: asc ? { fetchDay: (day) => fetchSalesDay(asc, day) } : null,
    ads: ads ? { fetch: (from, to) => fetchAdsDays(ads, from, to) } : null,
  };
}

const HOUR = 3_600_000;
/** A collected source is read again a day later; a failed one, an hour later. */
const REFRESH_MS = 24 * HOUR;
const RETRY_MS = HOUR;
const BACKFILL_DAYS = 180;
/** Every collection reads this many days again: RevenueCat and Apple Ads settle them late. */
const RECENT_DAYS = 7;
/** Sales reports come one day per request; a tick asks for at most this many. */
const SALES_PER_TICK = 15;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Runs from the tick. Each source is read once a day (an hour after a failure); the first
 * collection goes back 180 days, the sales report a few weeks per tick. One source failing never
 * stops the others. The result holds statuses only: the tick's answer must not carry numbers.
 */
export async function collectMetrics(store: Store, now: Date, clients: MetricClients): Promise<Record<MetricSource, string>> {
  const sources = await store.getSources();
  const yesterday = addDays(isoDay(now), -1);
  const oldest = addDays(yesterday, -(BACKFILL_DAYS - 1));
  const recentFrom = addDays(yesterday, -(RECENT_DAYS - 1));

  const health = (s: MetricSource) => sources.find((x) => x.source === s);
  const backingOff = (s: MetricSource) => {
    const h = health(s);
    const err = h?.lastErrorAt?.getTime() ?? 0;
    return err > (h?.lastOkAt?.getTime() ?? 0) && now.getTime() - err < RETRY_MS;
  };
  const fresh = (s: MetricSource) => {
    const ok = health(s)?.lastOkAt?.getTime();
    return ok !== undefined && now.getTime() - ok < REFRESH_MS;
  };

  /** A source read as one window: 180 days the first time, the last 7 after that. */
  async function windowed(source: MetricSource, read: (from: string, to: string) => Promise<{ days: MetricDay[]; error: string | null }>): Promise<string> {
    if (backingOff(source) || fresh(source)) return 'skipped';
    try {
      const first = (await store.getMetricBackfill(source)) === null;
      const from = first ? oldest : recentFrom;
      const { days, error } = await read(from, yesterday);
      await store.upsertMetricDays(days);
      if (first) await store.setMetricBackfill(source, from);
      if (error) {
        await store.touchSource(source, now, false, error);
        return error;
      }
      await store.touchSource(source, now, true);
      return 'ok';
    } catch (err) {
      await store.touchSource(source, now, false, message(err)).catch(() => {});
      return message(err);
    }
  }

  const out = {} as Record<MetricSource, string>;

  // RevenueCat: a key per project; a key that fails costs only itself.
  out.revenuecat = clients.revenuecat
    ? await windowed('revenuecat', async (from, to) => {
        const rc = clients.revenuecat!;
        const days: MetricDay[] = [];
        const errors: string[] = [];
        const projects = { ...(await store.getSettings()).revenuecatProjects };
        let named = false;
        for (const key of rc.keys) {
          try {
            for (const { project, days: d } of await rc.fetch(key, from, to)) {
              days.push(...d);
              const known = projects[project.id];
              if (!known || known.name !== project.name) {
                projects[project.id] = { name: project.name, projectId: known?.projectId ?? null };
                named = true;
              }
            }
          } catch (err) {
            errors.push(message(err));
          }
        }
        if (named) await store.patchSettings({ revenuecatProjects: projects });
        if (errors.length === rc.keys.length) throw new Error(errors.join('; '));
        return { days, error: errors.length > 0 ? errors.join('; ') : null };
      })
    : 'not configured';

  out.appstore_sales = clients.appstore ? await collectSales(clients.appstore) : 'not configured';

  out.apple_ads = clients.ads
    ? await windowed('apple_ads', async (from, to) => ({ days: await clients.ads!.fetch(from, to), error: null }))
    : 'not configured';

  return out;

  /** Sales: the last 7 days once a day, and the way back to 180 days a few weeks per tick. */
  async function collectSales(client: NonNullable<MetricClients['appstore']>): Promise<string> {
    const source = 'appstore_sales';
    let cursor = await store.getMetricBackfill(source);
    const refresh = !fresh(source);
    if (backingOff(source) || (!refresh && cursor !== null && cursor <= oldest)) return 'skipped';

    // A day Apple has no report for is a day without downloads, or (lately) one not published yet.
    const read = async (d: string) => {
      const got = await client.fetchDay(d);
      if (got !== 'not_yet') await store.upsertMetricDays(got);
    };
    try {
      let asked = 0;
      if (refresh) {
        for (let d = yesterday; d >= recentFrom; d = addDays(d, -1), asked++) await read(d);
        if (cursor === null || cursor > recentFrom) {
          cursor = recentFrom;
          await store.setMetricBackfill(source, cursor);
        }
      }
      cursor ??= addDays(yesterday, 1);
      // Each day read moves the mark, so a failure halfway loses nothing already read.
      for (; asked < SALES_PER_TICK && cursor > oldest; asked++) {
        const d = addDays(cursor, -1);
        await read(d);
        cursor = d;
        await store.setMetricBackfill(source, cursor);
      }
      if (refresh) await store.touchSource(source, now, true);
      return 'ok';
    } catch (err) {
      await store.touchSource(source, now, false, message(err)).catch(() => {});
      return message(err);
    }
  }
}
