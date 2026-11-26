import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BOARD, EMPTY_BOARD } from './fixture';
import { BASE } from './setup';

const SHOTS = process.env.E2E_SCREENSHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

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

/** A browser that carries a sign-in cookie, with the data API answered from a fixture. */
async function signedIn(
  board: unknown,
  o: { width?: number; height?: number; dark?: boolean; scale?: number } = {},
): Promise<{ page: Page; posts: { url: string; body: string | null }[] }> {
  context = await browser.newContext({
    viewport: { width: o.width ?? 390, height: o.height ?? 844 },
    colorScheme: o.dark ? 'dark' : 'light',
    deviceScaleFactor: o.scale ?? 1,
    locale: 'ru-RU',
  });
  // A `__Host-` cookie cannot be stored for plain http, so the test sends it as a header instead.
  await context.setExtraHTTPHeaders({ cookie: '__Host-wh_session=x' });
  const page = await context.newPage();
  const posts: { url: string; body: string | null }[] = [];
  await page.route('**/api/board', (route) => route.fulfill({ json: board }));
  await page.route(/\/api\/(items|runs)\//, (route) => {
    posts.push({ url: new URL(route.request().url()).pathname, body: route.request().postData() });
    return route.fulfill({ status: 204 });
  });
  return { page, posts };
}

describe('a stranger', () => {
  it('visiting the board is sent to the sign-in page, which names no project', async () => {
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE);
    expect(new URL(page.url()).pathname).toBe('/login');
    const html = await page.content();
    for (const word of ['Tenra', 'Dalada', 'Platina', 'DesignKit', 'Baja']) expect(html).not.toContain(word);
    expect(await page.getByRole('link', { name: 'Войти через GitHub' }).isVisible()).toBe(true);
  });

  it('is sent to sign-in from the settings page too', async () => {
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/settings`);
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  it.each([
    ['GET', '/api/board'],
    ['GET', '/api/backlog'],
    ['GET', '/api/settings'],
    ['POST', '/api/settings'],
    ['POST', '/api/items/anything'],
    ['POST', '/api/runs/1/cancel'],
    ['POST', '/api/github/webhook'],
    ['POST', '/api/report/session'],
    ['POST', '/api/report/sessions'],
    ['POST', '/api/telegram/webhook'],
    ['POST', '/api/cron/tick'],
    ['GET', '/api/cron/tick'],
  ])('%s %s answers 401 with not one byte', async (method, path) => {
    const res = await fetch(`${BASE}${path}`, { method, body: method === 'POST' ? '{}' : undefined });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it('a made-up sign-in cookie gets the empty shell and then the sign-in page, never data', async () => {
    context = await browser.newContext();
    await context.setExtraHTTPHeaders({ cookie: '__Host-wh_session=forged' });
    const page = await context.newPage();
    const shell = await (await context.request.get(BASE)).text();
    for (const word of ['Tenra', 'Dalada', 'Platina', 'Ждёт вас']) expect(shell).not.toContain(word);
    await page.goto(BASE);
    await page.waitForURL('**/login');
  });
});

describe('the owner’s board', () => {
  it.each([
    ['phone', 390, 844],
    ['desktop', 1280, 800],
  ])('shows the three blocks on a %s without sideways scrolling', async (name, width, height) => {
    const { page } = await signedIn(BOARD, { width, height, scale: SHOTS ? 2 : 1 });
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Ждёт вас (3)' }).waitFor();
    expect(await page.getByTestId('attention-row').count()).toBe(4);
    expect(await page.getByTestId('queue-row').count()).toBe(5);
    expect(await page.getByTestId('project-row').count()).toBe(4);
    await expect(page.getByText('идёт 2 · ждёт 3 · свободное место через ~1 ч 2 мин').isVisible()).resolves.toBe(true);
    await expect(page.getByText('отложено: 1').isVisible()).resolves.toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (SHOTS) {
      await page.locator('details').nth(1).locator('summary').click();
      await page.screenshot({ path: `${SHOTS}/board-${name}-light.png`, fullPage: true });
    }
  });

  it('says estimates with a tilde and the unknown with «~?»', async () => {
    const { page } = await signedIn(BOARD);
    await page.goto(BASE);
    const rows = page.getByTestId('queue-row');
    await rows.first().waitFor();
    expect(await rows.nth(0).innerText()).toContain('31 мин из ~50 мин');
    expect(await rows.nth(2).innerText()).toContain('ждёт 1 ч 10 мин · начнётся через ~19 мин');
    expect(await rows.nth(4).innerText()).toContain('начнётся через ~?');
    expect(await rows.nth(3).innerText()).toContain('устарел');
  });

  it('closing an item posts a dismiss for it', async () => {
    const { page, posts } = await signedIn(BOARD);
    await page.goto(BASE);
    const row = page.getByTestId('attention-row').first();
    await row.getByRole('button', { name: 'закрыть' }).click();
    await expect.poll(() => posts).toEqual([{ url: '/api/items/i1', body: '{"action":"dismiss"}' }]);
  });

  it('postponing offers «до завтра» and «на неделю»', async () => {
    const { page, posts } = await signedIn(BOARD);
    await page.goto(BASE);
    const row = page.getByTestId('attention-row').nth(1);
    await row.getByRole('button', { name: 'отложить' }).click();
    await row.getByRole('button', { name: 'на неделю' }).click();
    await expect.poll(() => posts).toEqual([{ url: '/api/items/i2', body: '{"action":"snooze","until":"week"}' }]);
  });

  it('cancelling a build asks first, and does nothing when the owner says no', async () => {
    const { page, posts } = await signedIn(BOARD);
    await page.goto(BASE);
    const stale = page.getByTestId('queue-row').nth(3);
    const questions: string[] = [];
    page.once('dialog', (d) => {
      questions.push(d.message());
      void d.dismiss();
    });
    await stale.getByRole('button', { name: 'отменить' }).click();
    expect(questions).toEqual(['Отменить сборку «CI» в Tenra (claude/paywall-gates-x7)?']);
    expect(posts).toEqual([]);
    page.once('dialog', (d) => void d.accept());
    await stale.getByRole('button', { name: 'отменить' }).click();
    await expect.poll(() => posts).toEqual([{ url: '/api/runs/104/cancel', body: null }]);
  });

  it('a running build that is not stale has no cancel button', async () => {
    const { page } = await signedIn(BOARD);
    await page.goto(BASE);
    const running = page.getByTestId('queue-row').first();
    await running.waitFor();
    expect(await running.getByRole('button', { name: 'отменить' }).count()).toBe(0);
  });

  it('an empty board says so in each block and shows the source warning', async () => {
    const { page } = await signedIn(EMPTY_BOARD, { dark: true, scale: SHOTS ? 2 : 1 });
    await page.goto(BASE);
    await page.getByText('Ничего не ждёт вашего внимания.').waitFor();
    await expect(page.getByText('Очередь пуста.').isVisible()).resolves.toBe(true);
    await expect(page.getByText('есть свободное место').isVisible()).resolves.toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'GitHub не сверялся' }).isVisible()).resolves.toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-empty-dark.png`, fullPage: true });
  });

  it('keeps the last data on screen and says «нет связи» when the server stops answering', async () => {
    const { page } = await signedIn(BOARD);
    await page.goto(BASE);
    await page.getByTestId('attention-row').first().waitFor();
    await page.unroute('**/api/board');
    await page.route('**/api/board', (route) => route.abort());
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByText('нет связи').waitFor();
    expect(await page.getByTestId('attention-row').count()).toBe(4);
  });

  it('dark theme on a phone', async () => {
    const { page } = await signedIn(BOARD, { dark: true, scale: SHOTS ? 2 : 1 });
    await page.goto(BASE);
    await page.getByTestId('attention-row').first().waitFor();
    // The theme's own dark background, whatever notation the browser reports it in: paint it and look.
    const [r, g, b] = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    });
    expect(Math.max(r!, g!, b!)).toBeLessThan(40);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-phone-dark.png`, fullPage: true });
  });
});
