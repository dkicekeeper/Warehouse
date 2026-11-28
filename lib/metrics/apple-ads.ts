import { addDays, type MetricDay, type MetricName } from '@/lib/domain/metrics';
import { SourceError, es256Jwt } from './jwt';

/** Apple Ads Platform API: impressions, taps, installs and spend per app and day (as `ads.py` in Tenra). */

export interface AdsConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  accountId: string;
}

export function adsConfig(env: Record<string, string | undefined>): AdsConfig | null {
  const v = (k: string) => env[k]?.trim() ?? '';
  const cfg = { clientId: v('ADS_CLIENT_ID'), teamId: v('ADS_TEAM_ID'), keyId: v('ADS_KEY_ID'), privateKey: v('ADS_PRIVATE_KEY'), accountId: v('ADS_ACCOUNT_ID') };
  return Object.values(cfg).every(Boolean) ? cfg : null;
}

const API = 'https://api.ads.apple.com/v1';
const TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
const PAGE = 1000;
/** Apple's DAILY granularity covers at most 90 days per report. */
const MAX_DAYS = 90;

interface Point {
  date?: string;
  impressions?: number;
  taps?: number;
  tapInstalls?: number;
  viewInstalls?: number;
  localSpend?: { amount?: string | number; currency?: string };
}

/** The campaigns report's daily points, added up per app (campaign id → App Store id in `apps`). */
export function parseCampaignReport(body: unknown, apps: Map<string, string>): MetricDay[] {
  const rows = ((body as { result?: { rows?: unknown[] } })?.result?.rows ?? []) as { metadata?: { id?: unknown }; granularMetrics?: Point[] }[];
  const sums = new Map<string, MetricDay>();
  const add = (app: string, day: string, metric: MetricName, value: number, unit: string) => {
    const key = `${app}\t${day}\t${metric}`;
    const cur = sums.get(key) ?? { app, source: 'apple_ads' as const, metric, day, value: 0, unit };
    cur.value += value;
    sums.set(key, cur);
  };
  for (const r of rows) {
    const app = apps.get(String(r.metadata?.id));
    if (!app) continue;
    for (const p of r.granularMetrics ?? []) {
      if (!p.date) continue;
      add(app, p.date, 'ad_impressions', Number(p.impressions) || 0, 'count');
      add(app, p.date, 'ad_taps', Number(p.taps) || 0, 'count');
      add(app, p.date, 'ad_installs', (Number(p.tapInstalls) || 0) + (Number(p.viewInstalls) || 0), 'count');
      add(app, p.date, 'ad_spend', Number(p.localSpend?.amount) || 0, p.localSpend?.currency || 'USD');
    }
  }
  return [...sums.values()];
}

async function accessToken(cfg: AdsConfig, fetchFn: typeof fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const secret = es256Jwt(
    { alg: 'ES256', kid: cfg.keyId },
    { sub: cfg.clientId, aud: 'https://appleid.apple.com', iat: now, exp: now + 3600, iss: cfg.teamId },
    cfg.privateKey,
  );
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: secret, scope: 'searchadsorg' }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new SourceError(res.status, 'Apple Ads token');
  const token = ((await res.json()) as { access_token?: string }).access_token;
  if (!token) throw new Error('Apple Ads token: no access_token');
  return token;
}

/** Every page of a POST …/query endpoint. */
async function queryAll(path: string, body: Record<string, unknown>, call: (path: string, body: unknown) => Promise<unknown>, pick: (r: unknown) => unknown[]) {
  const items: unknown[] = [];
  for (let offset = 0; ; ) {
    const res = (await call(path, { ...body, pagination: { offset, pageSize: PAGE } })) as { pagination?: { totalCount?: number } };
    const page = pick(res);
    items.push(...page);
    offset += page.length;
    const total = res.pagination?.totalCount;
    if (page.length < PAGE || (total !== undefined && offset >= total)) return items;
  }
}

/** Days `from` to `to` (inclusive, the ad account's time zone) of every campaign, per app. */
export async function fetchAdsDays(cfg: AdsConfig, from: string, to: string, fetchFn: typeof fetch = fetch): Promise<MetricDay[]> {
  const token = await accessToken(cfg, fetchFn);
  const call = async (path: string, body: unknown) => {
    const res = await fetchFn(API + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-AP-Context': `adAccountId=${cfg.accountId}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new SourceError(res.status, `Apple Ads ${path}`);
    return res.json() as Promise<unknown>;
  };

  const campaigns = (await queryAll('/campaigns/query', {}, call, (r) => ((r as { result?: unknown[] }).result ?? []))) as { id?: unknown; adamId?: unknown }[];
  const apps = new Map(campaigns.filter((c) => c.adamId != null).map((c) => [String(c.id), String(c.adamId)]));

  const out: MetricDay[] = [];
  for (let start = from; start <= to; start = addDays(start, MAX_DAYS)) {
    const end = addDays(start, MAX_DAYS - 1) < to ? addDays(start, MAX_DAYS - 1) : to;
    const rows = await queryAll(
      '/reports/apps/campaigns/query',
      { timeRange: { start, end, timeZone: 'ORTZ', granularity: 'DAILY' } },
      call,
      (r) => ((r as { result?: { rows?: unknown[] } }).result?.rows ?? []),
    );
    out.push(...parseCampaignReport({ result: { rows } }, apps));
  }
  return out;
}
