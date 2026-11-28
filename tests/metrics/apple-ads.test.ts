import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adsConfig, fetchAdsDays, parseCampaignReport } from '@/lib/metrics/apple-ads';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/metrics/${name}`, import.meta.url), 'utf8')) as unknown;
const CAMPAIGNS = fixture('ads-campaigns.json');
const REPORT = fixture('ads-report.json');
const APPS = new Map([['101', '6761530361'], ['102', '6761530361'], ['103', '6817603558']]);
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const CFG = { clientId: 'SEARCHADS.c1', teamId: 'SEARCHADS.t1', keyId: 'k1', privateKey: PEM, accountId: '777' };

describe('parseCampaignReport', () => {
  const rows = parseCampaignReport(REPORT, APPS);
  const v = (app: string, metric: string, day = '2026-11-20') => rows.find((r) => r.app === app && r.metric === metric && r.day === day)?.value;

  it('adds the campaigns of one app up per day', () => {
    expect(v('6761530361', 'ad_impressions')).toBe(1000);
    expect(v('6761530361', 'ad_taps')).toBe(50);
    expect(v('6761530361', 'ad_spend')).toBeCloseTo(9);
    expect(v('6761530361', 'ad_spend', '2026-11-21')).toBeCloseTo(4);
  });

  it('installs are by tap and by view, as Tenra counts them', () => {
    expect(v('6761530361', 'ad_installs')).toBe(20);
  });

  it('spend carries the account currency; counts are counts', () => {
    expect(rows.find((r) => r.metric === 'ad_spend')?.unit).toBe('USD');
    expect(rows.find((r) => r.metric === 'ad_taps')?.unit).toBe('count');
  });

  it('keeps each app apart, and drops a campaign whose app is unknown', () => {
    expect(v('6817603558', 'ad_installs')).toBe(1);
    expect(parseCampaignReport(REPORT, new Map([['101', '6761530361']])).some((r) => r.app === '6817603558')).toBe(false);
  });
});

describe('fetchAdsDays', () => {
  function fakeApple(calls: { url: string; init?: RequestInit }[], over: Partial<Record<string, Response>> = {}) {
    return (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith('https://appleid.apple.com/auth/oauth2/token')) {
        return over.token ?? Response.json({ access_token: 'tok', expires_in: 3600 });
      }
      if (url.endsWith('/reports/apps/campaigns/query')) return over.report ?? Response.json(REPORT);
      if (url.endsWith('/v1/campaigns/query')) return Response.json(CAMPAIGNS);
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
  }

  it('gets a token by client credentials, then reads campaigns and the daily report in the account', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const rows = await fetchAdsDays(CFG, '2026-11-18', '2026-11-24', fakeApple(calls));
    const tokenBody = new URLSearchParams(String(calls[0]!.init?.body));
    expect(tokenBody.get('grant_type')).toBe('client_credentials');
    expect(tokenBody.get('client_id')).toBe('SEARCHADS.c1');
    expect(tokenBody.get('scope')).toBe('searchadsorg');
    expect(tokenBody.get('client_secret')?.split('.')).toHaveLength(3);
    const report = calls.find((c) => c.url === 'https://api.ads.apple.com/v1/reports/apps/campaigns/query')!;
    const headers = new Headers(report.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('x-ap-context')).toBe('adAccountId=777');
    expect(JSON.parse(String(report.init?.body)).timeRange).toMatchObject({ start: '2026-11-18', end: '2026-11-24', granularity: 'DAILY' });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('more than 90 days goes as several reports', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await fetchAdsDays(CFG, '2026-05-29', '2026-11-24', fakeApple(calls));
    const ranges = calls.filter((c) => c.url.endsWith('/reports/apps/campaigns/query')).map((c) => JSON.parse(String(c.init?.body)).timeRange);
    expect(ranges.map((r: { start: string; end: string }) => [r.start, r.end])).toEqual([
      ['2026-05-29', '2026-08-26'],
      ['2026-08-27', '2026-11-24'],
    ]);
  });

  it('a refusal throws with the status, never the body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = fakeApple(calls, { token: new Response('invalid_client secret', { status: 401 }) });
    await expect(fetchAdsDays(CFG, '2026-11-18', '2026-11-24', fetchFn)).rejects.toThrow(/401/);
    await expect(fetchAdsDays(CFG, '2026-11-18', '2026-11-24', fetchFn)).rejects.not.toThrow(/secret/);
  });
});

describe('adsConfig', () => {
  it('needs all five variables', () => {
    const env = { ADS_CLIENT_ID: 'a', ADS_TEAM_ID: 'b', ADS_KEY_ID: 'c', ADS_PRIVATE_KEY: 'd', ADS_ACCOUNT_ID: 'e' };
    expect(adsConfig(env)).toEqual({ clientId: 'a', teamId: 'b', keyId: 'c', privateKey: 'd', accountId: 'e' });
    expect(adsConfig({ ...env, ADS_ACCOUNT_ID: '' })).toBeNull();
  });
});
