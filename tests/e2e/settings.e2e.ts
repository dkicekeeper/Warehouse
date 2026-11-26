import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { BASE } from './setup';

const VIEW = {
  settings: { workingTtlMin: 120, notifyDelayMin: 5, quietStart: '23:00', quietEnd: '08:00', timezone: 'Asia/Almaty', macosLimit: null, observedMacosLimit: 2 },
  telegram: { bound: false, linkCode: { code: 'K7Q2XW9A', expiresAt: new Date(Date.now() + 600_000).toISOString() } },
  projects: [
    { id: 'p1', name: 'Tenra', repos: ['dkicekeeper/Tenra', 'dkicekeeper/tenra-assets'] },
    { id: 'p2', name: 'Baja.kz', repos: ['dkicekeeper/AutoParts4x4'] },
  ],
  looseSessions: [{ id: 'session_f', title: 'Otbasy' }],
  sources: [
    { source: 'github_webhook', lastOkAt: new Date(Date.now() - 3 * 60_000).toISOString(), lastErrorAt: null, note: null },
    { source: 'reconcile', lastOkAt: null, lastErrorAt: new Date(Date.now() - 60_000).toISOString(), note: 'boom' },
  ],
};

let browser: Browser;
let context: BrowserContext | undefined;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(() => browser.close());
afterEach(() => context?.close());

async function open() {
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  // A `__Host-` cookie cannot be stored for plain http, so the test sends it as a header instead.
  await context.setExtraHTTPHeaders({ cookie: '__Host-wh_session=x' });
  const page = await context.newPage();
  const posts: unknown[] = [];
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: VIEW });
    posts.push(JSON.parse(route.request().postData() ?? 'null'));
    return route.fulfill({ status: 204 });
  });
  await page.goto(`${BASE}/settings`);
  await page.getByRole('heading', { name: 'Правила' }).waitFor();
  return { page, posts };
}

it('shows rules, the Telegram code, projects with repositories, loose sessions and source health', async () => {
  const { page } = await open();
  await expect(page.getByText('/start K7Q2XW9A').isVisible()).resolves.toBe(true);
  await expect(page.getByText('Пусто — брать наблюдаемое: 2').isVisible()).resolves.toBe(true);
  await expect(page.getByText('dkicekeeper/AutoParts4x4').isVisible()).resolves.toBe(true);
  await expect(page.getByText('Otbasy').isVisible()).resolves.toBe(true);
  await expect(page.getByText(/ошибка .*: boom/).isVisible()).resolves.toBe(true);
  await expect(page.getByText('успешно ни разу').first().isVisible()).resolves.toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

it('saving the rules posts numbers, and an empty limit as null', async () => {
  const { page, posts } = await open();
  await page.getByLabel('Сколько верить «работаю» без новостей, мин').fill('90');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect.poll(() => posts).toEqual([
    { action: 'update', settings: { workingTtlMin: 90, notifyDelayMin: 5, quietStart: '23:00', quietEnd: '08:00', macosLimit: null } },
  ]);
  await page.getByText('Сохранено.').waitFor();
});

it('assigning a loose session and moving a repository post the right actions', async () => {
  const { page, posts } = await open();
  await page.getByLabel('Otbasy').selectOption('p2');
  await page.getByLabel('Перенести dkicekeeper/tenra-assets в другой проект').selectOption('p2');
  await expect.poll(() => posts).toEqual([
    { action: 'assignSession', sessionId: 'session_f', projectId: 'p2' },
    { action: 'moveRepo', repo: 'dkicekeeper/tenra-assets', projectId: 'p2' },
  ]);
});
