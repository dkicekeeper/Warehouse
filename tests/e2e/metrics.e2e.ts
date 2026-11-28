import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appOwner, summarize, type MetricDay, type MetricName, type MetricSource } from '@/lib/domain/metrics';
import { BOARD } from './fixture';
import { BASE } from './setup';

const SHOTS = process.env.E2E_SCREENSHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// Invented numbers, in the shape the endpoint gives: 7 days before 25 November.
const NOW = new Date('2026-11-25T07:00:00Z');
const SRC: Partial<Record<MetricName, MetricSource>> = { installs: 'appstore_sales', ad_installs: 'apple_ads', ad_spend: 'apple_ads', trials_new: 'revenuecat', actives: 'revenuecat', mrr: 'revenuecat', revenue_net: 'revenuecat' };
const rows: MetricDay[] = [];
for (let n = 11; n <= 24; n++) {
  const day = `2026-11-${n}`;
  const add = (app: string, metric: MetricName, value: number) =>
    rows.push({ app, source: SRC[metric]!, metric, day, value, unit: metric === 'ad_spend' || metric === 'mrr' || metric === 'revenue_net' ? 'USD' : 'count' });
  add('6761530361', 'installs', 10 + (n % 5));
  add('6761530361', 'ad_installs', 6 + (n % 3));
  add('6761530361', 'ad_spend', 8.5);
  add('rc:p1', 'trials_new', n % 3 === 0 ? 1 : 0);
  add('6817603558', 'installs', 2 + (n % 2));
}
const owner = appOwner(
  [
    { id: 'p-tenra', name: 'Tenra', storeUrl: 'https://apps.apple.com/app/id6761530361' },
    { id: 'p-dalada', name: 'Dalada', storeUrl: 'https://apps.apple.com/kz/app/dalada/id6817603558' },
  ],
  { p1: { name: 'Tenra', projectId: null } },
);
const products = summarize(rows, owner, 7, NOW);
const METRICS = {
  days: 7,
  trialCostLimit: 15,
  products,
  total: { installs: { value: 120, previous: 110, change: 120 / 110 - 1 }, revenue: [], adSpend: [{ amount: 59.5, currency: 'USD' }] },
  sources: [
    { source: 'revenuecat', configured: true, lastOkAt: '2026-11-25T06:10:00Z', lastErrorAt: null, note: null, dataUntil: '2026-11-24' },
    { source: 'appstore_sales', configured: true, lastOkAt: '2026-11-25T06:11:00Z', lastErrorAt: null, note: null, dataUntil: '2026-11-24' },
    { source: 'apple_ads', configured: false, lastOkAt: null, lastErrorAt: null, note: null, dataUntil: null },
  ],
};
const NOTHING = { ...METRICS, products: [], sources: METRICS.sources.map((s) => ({ ...s, configured: false, lastOkAt: null })) };

let browser: Browser;
let context: BrowserContext | undefined;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(() => browser.close());
afterEach(async () => {
  await context?.close();
  context = undefined;
});

async function signedIn(body: unknown, o: { width?: number; height?: number; dark?: boolean } = {}): Promise<Page> {
  context = await browser.newContext({
    viewport: { width: o.width ?? 390, height: o.height ?? 844 },
    colorScheme: o.dark ? 'dark' : 'light',
    deviceScaleFactor: SHOTS ? 2 : 1,
    locale: 'ru-RU',
  });
  await context.setExtraHTTPHeaders({ cookie: '__Host-wh_session=x' });
  const page = await context.newPage();
  await page.route('**/api/board', (route) => route.fulfill({ json: BOARD }));
  await page.route('**/api/metrics**', (route) => route.fulfill({ json: body }));
  return page;
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

describe('metrics', () => {
  it('a stranger gets 401 from /api/metrics with not one byte', async () => {
    const res = await fetch(`${BASE}/api/metrics?days=7`);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it.each([
    ['phone', 390, 844, false],
    ['desktop', 1280, 900, false],
    ['desktop-dark', 1280, 900, true],
  ])('shows each product with its numbers and a daily chart on a %s, without sideways scrolling', async (name, width, height, dark) => {
    const page = await signedIn(METRICS, { width: width as number, height: height as number, dark: dark as boolean });
    await page.goto(`${BASE}/metrics`);
    await page.getByTestId('metrics-product').first().waitFor();
    expect(await page.getByTestId('metrics-product').count()).toBe(2);
    expect(await page.getByTestId('metrics-product').first().textContent()).toContain('Tenra');
    expect(await page.getByTestId('metrics-chart').count()).toBe(2);
    expect(await page.getByTestId('metrics-sources').textContent()).toContain('Apple Ads: не настроен');
    expect(await noSidewaysScroll(page)).toBe(true);
    // Six sections fit the phone's tab bar on one row.
    if (width === 390) {
      const tops = await page.getByRole('navigation', { name: 'Разделы' }).last().getByRole('link').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().top));
      expect(new Set(tops).size).toBe(1);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/metrics-${name}.png`, fullPage: true });
  });

  it('the period buttons ask for 28 days', async () => {
    const page = await signedIn(METRICS, { width: 1280, height: 900 });
    const asked: string[] = [];
    page.on('request', (r) => r.url().includes('/api/metrics') && asked.push(new URL(r.url()).searchParams.get('days') ?? ''));
    await page.goto(`${BASE}/metrics`);
    await page.getByTestId('metrics-product').first().waitFor();
    await page.getByRole('button', { name: '28 дней' }).click();
    await expect.poll(() => asked).toContain('28');
  });

  it('with no source connected it says which keys to put where', async () => {
    const page = await signedIn(NOTHING);
    await page.goto(`${BASE}/metrics`);
    await page.getByText('Источники метрик не подключены').waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/metrics-empty.png`, fullPage: true });
  });

  it('the menu leads to the page', async () => {
    const page = await signedIn(METRICS, { width: 1280, height: 900 });
    await page.goto(`${BASE}/`);
    await page.getByRole('link', { name: 'Метрики' }).first().click();
    await page.waitForURL(`${BASE}/metrics`);
  });
});
