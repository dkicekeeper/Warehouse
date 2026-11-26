import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildBacklogView, summarizeBacklog } from '@/lib/domain/backlog';
import type { ProjectDoc } from '@/lib/domain/docs';
import { BOARD } from './fixture';
import { BASE } from './setup';

const SHOTS = process.env.E2E_SCREENSHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const projects = [{ id: 'p-platina', name: 'Platina' }, { id: 'p-tenra', name: 'Tenra' }];
const repos = [
  { fullName: 'dkicekeeper/Platina', projectId: 'p-platina', defaultBranch: 'main' },
  { fullName: 'dkicekeeper/Tenra', projectId: 'p-tenra', defaultBranch: 'main' },
];
const doc = (repo: string, kind: ProjectDoc['kind'], id: string, title: string, status: string | null, fields: Record<string, unknown>, body: string): ProjectDoc => ({
  repo, kind, id, title, status, fields, body, blobSha: 's',
  path: kind === 'project' ? 'docs/project.md' : `docs/${kind === 'task' ? 'backlog' : kind === 'plan' ? 'plans' : 'decisions'}/${id}.md`,
});
const DOCS: ProjectDoc[] = [
  doc('dkicekeeper/Platina', 'project', 'project', 'Platina', 'beta', { stage: 'beta', kind: 'ios-app', links: { site: 'https://example.com/platina', testflight: true } }, 'Трекер трофеев PlayStation с ИИ-наставником.\n\nСейчас: 1.0 готова к отправке в App Store.'),
  doc('dkicekeeper/Platina', 'task', '2026-11-26-app-store-submission', 'Этап 11: отправить 1.0 в App Store', 'blocked', { priority: 1, type: 'chore', size: 'm', 'needs-owner': 'шаги владельца в App Store Connect по чек-листу docs/app-store.md', updated: '2026-11-26' }, 'Зачем: страница заполнена, сборки загружены.\n\nГотово, когда:\n- версия отправлена на проверку.'),
  doc('dkicekeeper/Platina', 'task', '2026-11-26-cloudkit-production', 'Выкатить схему CloudKit в продакшен', 'ready', { priority: 2, type: 'chore', size: 's' }, 'Зачем: без схемы iCloud не сохраняет данные.'),
  doc('dkicekeeper/Platina', 'task', '2026-11-26-native-macos', 'Нативный macOS или Mac Catalyst', 'idea', { priority: 3, type: 'feature' }, 'Открытый вопрос плана приложения.'),
  doc('dkicekeeper/Platina', 'plan', '2026-11-25-platina-1.1', 'Platina 1.1 Implementation Plan', 'in-progress', { kind: 'plan', approved: '2026-11-25', tasks: ['a', 'b'] }, ''),
  doc('dkicekeeper/Platina', 'decision', '2026-11-23-less-glass', 'Стекло', 'active', { decided: '2026-11-23', by: 'owner' }, 'Решение: меньше Liquid Glass, карточки и секции серой заливкой.'),
  doc('dkicekeeper/Tenra', 'task', '2026-11-26-a-very-long-identifier-that-must-not-push-the-page-sideways', 'Сетевой секрет REPORT_TOKEN в окружении Tenra, без которого сессии этого проекта не видны на панели диспетчерской', 'blocked', { priority: 1, 'needs-owner': 'в любой сессии Tenra попросить сетевой секрет для warehouse-henna-pi.vercel.app и вставить значение' }, 'Зачем: хук молчит.'),
  doc('dkicekeeper/Tenra', 'task', '2026-11-26-assistant-performance', 'Assistant performance', 'in-progress', { priority: 2, branch: 'claude/assistant-performance-with-a-long-branch-name-x7', pr: 170 }, 'Full-resolution photo decode on the main thread.'),
];
const VIEW = buildBacklogView(projects, repos, DOCS, new Date());
const BACKLOG = { ...VIEW, syncedAt: new Date(Date.now() - 3 * 60_000).toISOString() };

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

async function signedIn(o: { width?: number; height?: number; dark?: boolean; scale?: number } = {}): Promise<Page> {
  context = await browser.newContext({
    viewport: { width: o.width ?? 390, height: o.height ?? 844 },
    colorScheme: o.dark ? 'dark' : 'light',
    deviceScaleFactor: o.scale ?? 1,
    locale: 'ru-RU',
  });
  await context.setExtraHTTPHeaders({ cookie: '__Host-wh_session=x' });
  const page = await context.newPage();
  await page.route('**/api/backlog', (route) => route.fulfill({ json: BACKLOG }));
  await page.route('**/api/board', (route) => route.fulfill({ json: { ...BOARD, backlog: summarizeBacklog(VIEW) } }));
  return page;
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

describe('a stranger', () => {
  it('is sent to sign-in from the backlog page', async () => {
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/backlog`);
    expect(new URL(page.url()).pathname).toBe('/login');
  });
});

describe('the backlog page', () => {
  it.each([
    ['phone', 390, 844],
    ['desktop', 1280, 800],
  ])('lists the tasks of every project on a %s without sideways scrolling', async (name, width, height) => {
    const page = await signedIn({ width, height, scale: SHOTS ? 2 : 1 });
    await page.goto(`${BASE}/backlog`);
    await page.getByRole('heading', { name: 'Задачи и планы' }).waitFor();
    await expect.poll(() => page.getByTestId('task-row').count()).toBe(5);
    const first = page.getByTestId('task-row').first();
    expect(await first.textContent()).toContain('ждёт вас');
    expect(await first.textContent()).toContain('Нужно от вас:');
    expect(await page.getByText('прочитано 3 мин назад').isVisible()).toBe(true);
    expect(await noSidewaysScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/backlog-${name}.png`, fullPage: true });
  });

  it('filters by what waits for the owner', async () => {
    const page = await signedIn();
    await page.goto(`${BASE}/backlog`);
    await page.getByRole('button', { name: 'Ждут вас' }).click();
    await expect.poll(() => page.getByTestId('task-row').count()).toBe(2);
    await page.getByRole('button', { name: 'Идеи' }).click();
    await expect.poll(() => page.getByTestId('task-row').count()).toBe(1);
  });

  it('shows a project: passport, its tasks, plans and decisions, and keeps the choice in the address', async () => {
    const page = await signedIn({ scale: SHOTS ? 2 : 1 });
    await page.goto(`${BASE}/backlog`);
    await page.getByRole('button', { name: /^Platina/ }).click();
    await page.getByTestId('passport').waitFor();
    expect(await page.getByTestId('passport').textContent()).toContain('бета');
    expect(await page.getByTestId('passport').textContent()).toContain('Трекер трофеев');
    expect(await page.getByTestId('task-row').count()).toBe(3);
    expect(await page.getByRole('heading', { name: 'Планы в работе' }).isVisible()).toBe(true);
    expect(await page.getByRole('heading', { name: 'Решения' }).isVisible()).toBe(true);
    expect(new URL(page.url()).searchParams.get('project')).toBe('p-platina');
    await page.getByTestId('task-row').first().locator('summary').click();
    expect(await page.getByRole('link', { name: 'файл в GitHub' }).first().getAttribute('href')).toBe(
      'https://github.com/dkicekeeper/Platina/blob/main/docs/backlog/2026-11-26-app-store-submission.md',
    );
    expect(await noSidewaysScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/backlog-project.png`, fullPage: true });
  });

  it('opens on the project named in the address', async () => {
    const page = await signedIn();
    await page.goto(`${BASE}/backlog?project=p-tenra`);
    await page.getByTestId('passport').waitFor();
    expect(await page.getByTestId('task-row').count()).toBe(2);
    expect(await page.getByTestId('passport').textContent()).toContain('нет паспорта');
  });

  it('says so when nothing was read yet', async () => {
    const page = await signedIn();
    await page.route('**/api/backlog', (route) => route.fulfill({ json: { generatedAt: new Date().toISOString(), projects: [], ownerTasks: [], syncedAt: null } }));
    await page.goto(`${BASE}/backlog`);
    await page.getByText('Пока пусто').waitFor();
    expect(await page.getByText('репозитории ещё не прочитаны').isVisible()).toBe(true);
  });
});

describe('the overview and projects with backlog data', () => {
  it('shows the tasks that wait for the owner as their own block and links each project to its tasks', async () => {
    const page = await signedIn({ scale: SHOTS ? 2 : 1 });
    await page.goto(BASE);
    await page.getByTestId('owner-task').first().waitFor();
    expect(await page.getByTestId('owner-task').count()).toBe(2);
    expect(await page.getByTestId('attention-row').count()).toBe(4);
    await page.getByRole('tab', { name: /Задачи/ }).click();
    expect(await page.getByTestId('attention-row').count()).toBe(0);
    expect(await page.getByTestId('owner-task').count()).toBe(2);
    expect(await noSidewaysScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-with-backlog.png`, fullPage: true });
  });

  it('the projects page shows each project with its stage and its tasks', async () => {
    const page = await signedIn({ width: 1280, height: 900, scale: SHOTS ? 2 : 1 });
    await page.goto(`${BASE}/projects`);
    const card = page.getByTestId('project-row').first();
    await card.waitFor();
    expect(await card.textContent()).toContain('бета');
    const docs = card.getByTestId('project-docs');
    expect(await docs.getByRole('link').getAttribute('href')).toBe('/backlog?project=p-platina');
    expect(await noSidewaysScroll(page)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/projects-desktop.png`, fullPage: true });
  });
});
