import { gunzipSync } from 'node:zlib';
import type { MetricDay, MetricName } from '@/lib/domain/metrics';
import { SourceError, es256Jwt } from './jwt';

/** App Store Connect's daily sales reports: downloads per app and day. */

export interface AppStoreConfig {
  keyId: string;
  issuerId: string;
  privateKey: string;
  vendorNumber: string;
}

export function appStoreConfig(env: Record<string, string | undefined>): AppStoreConfig | null {
  const keyId = env.ASC_KEY_ID?.trim();
  const issuerId = env.ASC_ISSUER_ID?.trim();
  const privateKey = env.ASC_KEY_P8?.trim();
  const vendorNumber = env.ASC_VENDOR_NUMBER?.trim();
  return keyId && issuerId && privateKey && vendorNumber ? { keyId, issuerId, privateKey, vendorNumber } : null;
}

/** Product types of an app's download: `1…` the first one, `3…` again on another device or after deleting. */
const KIND: Record<string, MetricName> = { '1': 'installs', '1F': 'installs', '1T': 'installs', '3': 'redownloads', '3F': 'redownloads', '3T': 'redownloads' };

export function parseSalesReport(tsv: string, day: string): MetricDay[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = lines[0]!.split('\t');
  const col = (name: string) => header.indexOf(name);
  const [type, units, app] = [col('Product Type Identifier'), col('Units'), col('Apple Identifier')];
  if (type < 0 || units < 0 || app < 0) throw new Error('sales report: unexpected columns');

  const sums = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const f = line.split('\t');
    const metric = KIND[f[type] ?? ''];
    if (!metric || !f[app]) continue;
    const key = `${f[app]}\t${metric}`;
    sums.set(key, (sums.get(key) ?? 0) + Math.trunc(Number(f[units]) || 0));
  }
  const out: MetricDay[] = [];
  const apps = new Set([...sums.keys()].map((k) => k.split('\t')[0]!));
  for (const a of apps) {
    for (const metric of ['installs', 'redownloads'] as const) {
      out.push({ app: a, source: 'appstore_sales', metric, day, value: sums.get(`${a}\t${metric}`) ?? 0, unit: 'count' });
    }
  }
  return out;
}

const API = 'https://api.appstoreconnect.apple.com';

function token(cfg: AppStoreConfig): string {
  const now = Math.floor(Date.now() / 1000);
  return es256Jwt(
    { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' },
    { iss: cfg.issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' },
    cfg.privateKey,
  );
}

/** One day's report (US Pacific day, as Apple keeps them). `not_yet`: Apple has no report for it (yet). */
export async function fetchSalesDay(cfg: AppStoreConfig, day: string, fetchFn: typeof fetch = fetch): Promise<MetricDay[] | 'not_yet'> {
  const q = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportType]': 'SALES',
    'filter[reportSubType]': 'SUMMARY',
    'filter[vendorNumber]': cfg.vendorNumber,
    'filter[reportDate]': day,
    'filter[version]': '1_1',
  });
  const res = await fetchFn(`${API}/v1/salesReports?${q}`, {
    headers: { Authorization: `Bearer ${token(cfg)}`, Accept: 'application/a-gzip' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return 'not_yet';
  if (!res.ok) throw new SourceError(res.status, 'App Store Connect salesReports');
  const raw = Buffer.from(await res.arrayBuffer());
  return parseSalesReport(gunzipSync(raw).toString('utf8'), day);
}
