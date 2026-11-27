import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { handleGuides } from '@/lib/api/guides';
import { BOARD } from './fixture';
import { BASE } from './setup';

const SHOTS = process.env.E2E_SCREENSHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let browser: Browser;
let context: BrowserContext | undefined;
let GUIDES: unknown;
beforeAll(async () => {
  browser = await chromium.launch();
  // The real guides of this repository, as the endpoint gives them to the owner.
  GUIDES = await (await handleGuides({ isOwner: async () => true })).json();
});
afterAll(() => browser.close());
afterEach(async () => {
  await context?.close();
  context = undefined;
});

async function signedIn(o: { width?: number; height?: number; dark?: boolean; scale?: number } = {}): Promise<Page> {
  context = await browser.newContext({
    viewport: { width: o.width ?? 390, height: o.height ?? 844 },
    colorScheme: o.dark ? 'dark' : 'light',
    deviceScaleFactor: o.scale ?? 1,
    locale: 'ru-RU',
  });
  await context.setExtraHTTPHeaders({ cookie: '__Host-wh_session=x' });
  const page = await context.newPage();
  await page.route('**/api/board', (route) => route.fulfill({ json: BOARD }));
  await page.route('**/api/guides', (route) => route.fulfill({ json: GUIDES }));
  return page;
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

describe('guides', () => {
  it('a stranger gets 401 from /api/guides with not one byte', async () => {
    const res = await fetch(`${BASE}/api/guides`);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it.each([
    ['phone', 390, 844],
    ['desktop', 1280, 900],
  ])('the index lists the eight guides on a %s without sideways scrolling', async (name, width, height) => {
    const page = await signedIn({ width, height, scale: SHOTS ? 2 : 1 });
    await page.goto(`${BASE}/guides`);
    await page.getByTestId('guide-card').first().waitFor();
    expect(await page.getByTestId('guide-card').count()).toBe(8);
    expect(await noSidewaysScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/guides-${name}.png`, fullPage: true });
  });

  it('a guide shows its rules with how each is checked and a link to propose a change', async () => {
    const page = await signedIn({ width: 1280, height: 900, scale: SHOTS ? 2 : 1 });
    await page.goto(`${BASE}/guides?g=docs`);
    const rule = page.locator('#DOC-3');
    await rule.waitFor();
    expect(await rule.innerText()).toContain('Новых папок не заводят');
    expect(await rule.innerText()).toContain('автоматически: lint.py tree');
    const href = await rule.getByTestId('propose').getAttribute('href');
    const url = new URL(href!);
    expect(url.pathname).toBe('/dkicekeeper/Warehouse/new/main');
    expect(url.searchParams.get('filename')).toMatch(/^docs\/backlog\/\d{4}-\d{2}-\d{2}-guide-doc-3\.md$/);
    expect(await noSidewaysScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/guide-docs-desktop.png`, fullPage: true });
  });

  it('a guide reads on a phone in the dark without sideways scrolling', async () => {
    const page = await signedIn({ dark: true, scale: SHOTS ? 2 : 1 });
    await page.goto(`${BASE}/guides?g=design`);
    await page.getByTestId('rule-card').first().waitFor();
    expect(await noSidewaysScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/guide-design-phone-dark.png`, fullPage: true });
  });

  it('the menu leads to the guides', async () => {
    const page = await signedIn({ width: 1280, height: 900 });
    await page.goto(BASE);
    await page.getByRole('navigation', { name: 'Разделы' }).first().getByRole('link', { name: 'Гайдлайны' }).click();
    await page.getByTestId('guide-card').first().waitFor();
    expect(new URL(page.url()).pathname).toBe('/guides');
  });
});
