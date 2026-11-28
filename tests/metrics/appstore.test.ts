import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { appStoreConfig, fetchSalesDay, parseSalesReport } from '@/lib/metrics/appstore';
import { es256Jwt, pemKey } from '@/lib/metrics/jwt';

const TSV = readFileSync(new URL('../fixtures/metrics/sales-2026-11-20.tsv', import.meta.url), 'utf8');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

describe('es256Jwt', () => {
  it('signs header.claims with ES256 in the raw r‖s form JWT wants', () => {
    const token = es256Jwt({ alg: 'ES256', kid: 'K1', typ: 'JWT' }, { iss: 'I', aud: 'appstoreconnect-v1' }, PEM);
    const [h, c, sig] = token.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'K1', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({ iss: 'I', aud: 'appstoreconnect-v1' });
    const raw = Buffer.from(sig!, 'base64url');
    expect(raw).toHaveLength(64);
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(true);
  });
});

describe('pemKey', () => {
  const body = PEM.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');

  it('takes a PEM, a PEM pasted on one line, the bare body, and the PEM in base64', () => {
    expect(pemKey(PEM)).toBe(pemKey(PEM.replace(/\n/g, '\\n')));
    expect(pemKey(body)).toBe(pemKey(PEM));
    expect(pemKey(Buffer.from(PEM).toString('base64'))).toBe(pemKey(PEM));
    expect(() => es256Jwt({ alg: 'ES256' }, {}, body)).not.toThrow();
  });
});

describe('parseSalesReport', () => {
  const rows = parseSalesReport(TSV, '2026-11-20');
  const value = (app: string, metric: string) => rows.find((r) => r.app === app && r.metric === metric)?.value;

  it('counts first-time downloads and redownloads per app, refunds taken off', () => {
    expect(value('6761530361', 'installs')).toBe(14);
    expect(value('6761530361', 'redownloads')).toBe(2);
    expect(value('6817603558', 'installs')).toBe(4);
    expect(value('6817603558', 'redownloads')).toBe(1);
  });

  it('in-app purchases and subscriptions are not downloads', () => {
    expect(rows.some((r) => r.app === '6761600000')).toBe(false);
  });

  it('rows are days of the source, counted', () => {
    expect(rows.every((r) => r.source === 'appstore_sales' && r.day === '2026-11-20' && r.unit === 'count')).toBe(true);
  });

  it('an app with no downloads that day has no rows; an empty report has none at all', () => {
    const only = parseSalesReport(TSV.split('\n').filter((l) => !l.includes('\t1F\t') && !l.includes('\t3F\t')).join('\n'), '2026-11-20');
    expect(only.filter((r) => r.app === '6761530361')).toEqual([]);
    expect(parseSalesReport('', '2026-11-20')).toEqual([]);
  });
});

describe('fetchSalesDay', () => {
  const cfg = { keyId: 'K1', issuerId: 'I1', privateKey: PEM, vendorNumber: '12345' };

  it('asks for the daily summary report of the day and reads the gzip', async () => {
    let seen: { url: string; headers: Headers } | null = null;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen = { url, headers: new Headers(init?.headers) };
      return new Response(gzipSync(TSV), { status: 200 });
    }) as unknown as typeof fetch;
    const rows = await fetchSalesDay(cfg, '2026-11-20', fetchFn);
    const u = new URL(seen!.url);
    expect(u.origin + u.pathname).toBe('https://api.appstoreconnect.apple.com/v1/salesReports');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      'filter[frequency]': 'DAILY',
      'filter[reportType]': 'SALES',
      'filter[reportSubType]': 'SUMMARY',
      'filter[vendorNumber]': '12345',
      'filter[reportDate]': '2026-11-20',
      'filter[version]': '1_1',
    });
    expect(seen!.headers.get('accept')).toBe('application/a-gzip');
    expect(seen!.headers.get('authorization')).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(rows).not.toBe('not_yet');
    expect((rows as unknown[]).length).toBe(4);
  });

  it('a day Apple has no report for yet is «not yet», not a failure', async () => {
    const fetchFn = (async () => new Response('{"errors":[{"code":"NOT_FOUND"}]}', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchSalesDay(cfg, '2026-11-24', fetchFn)).toBe('not_yet');
  });

  it('a refusal throws with the status and the path, never the body', async () => {
    const fetchFn = (async () => new Response('secret detail', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchSalesDay(cfg, '2026-11-20', fetchFn)).rejects.toThrow(/401/);
    await expect(fetchSalesDay(cfg, '2026-11-20', fetchFn)).rejects.not.toThrow(/secret/);
  });
});

describe('appStoreConfig', () => {
  it('needs all four variables', () => {
    expect(appStoreConfig({ ASC_KEY_ID: 'a', ASC_ISSUER_ID: 'b', ASC_KEY_P8: 'c', ASC_VENDOR_NUMBER: 'd' })).toEqual({
      keyId: 'a', issuerId: 'b', privateKey: 'c', vendorNumber: 'd',
    });
    expect(appStoreConfig({ ASC_KEY_ID: 'a', ASC_ISSUER_ID: 'b', ASC_KEY_P8: 'c' })).toBeNull();
  });
});
