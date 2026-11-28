import { isStale } from '@/lib/domain/queue';
import { macHistory } from '@/lib/domain/mac-history';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { buildBacklogView, summarizeBacklog } from '@/lib/domain/backlog';
import { buildBoardView } from '@/lib/domain/board';
import { dismissPatch, snoozePatch } from '@/lib/domain/items';
import { estimateQueue } from '@/lib/domain/queue';
import type { GithubApp } from '@/lib/github/app';
import type { Store } from '@/lib/store/store';

export interface OwnerDeps {
  store: Store;
  now: Date;
  /** The real check: is the request from the signed-in owner. */
  isOwner: () => Promise<boolean>;
  github: GithubApp | null;
}

const MINUTE = 60_000;
const LINK_CODE_MINUTES = 15;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const empty = (status: number) => new Response(null, { status });
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** 08:00 on the next calendar day in the given time zone. */
export function nextMorning(now: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + 1, 8, 0, 0) - offset);
}

export async function handleBoard(deps: OwnerDeps): Promise<Response> {
  if (!(await deps.isOwner())) return empty(401);
  const { store, now } = deps;
  const [snap, items, history, sources, settings] = await Promise.all([
    store.loadSnapshot(now),
    store.loadItems(),
    store.loadJobHistory(now),
    store.getSources(),
    store.getSettings(),
  ]);
  const queue = estimateQueue({ runs: snap.runs, jobs: snap.jobs, history, sessions: snap.sessions }, now, settings);
  // Right after a deploy the table may not exist yet (the tick creates it): the board must still open.
  const docs = await store.listDocs().catch(() => []);
  const backlog = summarizeBacklog(buildBacklogView(snap.projects, snap.repos, docs, now));
  const macBuilds = macHistory(history, snap.repos, snap.projects, now, settings.timezone);
  return json({ ...buildBoardView(snap, items, queue, sources, now, settings), backlog, macBuilds });
}

/** Tasks, plans and decisions of every project, as their repositories hold them. */
export async function handleBacklog(deps: OwnerDeps): Promise<Response> {
  if (!(await deps.isOwner())) return empty(401);
  const { store, now } = deps;
  const [snap, docs, state] = await Promise.all([
    store.loadSnapshot(now),
    store.listDocs().catch(() => []),
    store.listDocsState().catch(() => []),
  ]);
  const read = state.map((s) => s.syncedAt?.getTime() ?? 0).filter((t) => t > 0);
  return json({
    ...buildBacklogView(snap.projects, snap.repos, docs, now),
    syncedAt: read.length > 0 ? new Date(Math.max(...read)).toISOString() : null,
  });
}

const ItemAction = z.union([
  z.object({ action: z.literal('dismiss') }).strict(),
  z.object({ action: z.literal('snooze'), until: z.enum(['tomorrow', 'week']) }).strict(),
]);

export async function handleItemAction(req: Request, id: string, deps: OwnerDeps): Promise<Response> {
  if (!(await deps.isOwner())) return empty(401);
  const parsed = ItemAction.safeParse(await body(req));
  if (!parsed.success) return empty(400);
  const item = await deps.store.getItem(id);
  if (!item || item.status === 'resolved') return empty(404);
  if (parsed.data.action === 'dismiss') {
    await deps.store.patchItem(id, dismissPatch(item));
  } else {
    const settings = await deps.store.getSettings();
    const until =
      parsed.data.until === 'week'
        ? new Date(deps.now.getTime() + 7 * 1440 * MINUTE)
        : nextMorning(deps.now, settings.timezone);
    await deps.store.patchItem(id, snoozePatch(until));
  }
  return empty(204);
}

export async function handleCancelRun(idParam: string, deps: OwnerDeps): Promise<Response> {
  if (!(await deps.isOwner())) return empty(401);
  if (!/^\d{1,18}$/.test(idParam)) return empty(404);
  const run = await deps.store.getRun(Number(idParam));
  if (!run) return empty(404);
  if (run.status === 'completed') return empty(409);
  // A build that is running and nothing newer replaces is not the owner's to stop from the page:
  // only a waiting build or one a newer push made stale gets the button, and so the API.
  if (run.status === 'in_progress') {
    const { runs } = await deps.store.loadSnapshot(deps.now);
    if (!isStale(run, runs)) return empty(409);
  }
  if (!deps.github) return json({ error: 'Приложение GitHub не настроено' }, 503);
  try {
    await deps.github.cancelRun(run.repo, run.id);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'GitHub отказал' }, 502);
  }
  return empty(204);
}

export async function handleSettingsGet(deps: OwnerDeps): Promise<Response> {
  if (!(await deps.isOwner())) return empty(401);
  const [settings, snap, sources] = await Promise.all([
    deps.store.getSettings(),
    deps.store.loadSnapshot(deps.now),
    deps.store.getSources(),
  ]);
  const repoProject = new Set(snap.repos.map((r) => r.fullName));
  const link = settings.telegramLinkCode;
  return json({
    settings: {
      workingTtlMin: settings.workingTtlMin,
      notifyDelayMin: settings.notifyDelayMin,
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
      timezone: settings.timezone,
      macosLimit: settings.macosLimit,
      observedMacosLimit: settings.observedMacosLimit,
    },
    telegram: {
      bound: settings.telegramChatId !== null,
      linkCode: link && link.expiresAt.getTime() > deps.now.getTime() ? link : null,
    },
    projects: snap.projects.map((p) => ({
      id: p.id,
      name: p.name,
      repos: snap.repos.filter((r) => r.projectId === p.id).map((r) => r.fullName),
    })),
    looseSessions: snap.sessions
      .filter((s) => !s.archived && s.projectId === null && !(s.repo && repoProject.has(s.repo)))
      .map((s) => ({ id: s.id, title: s.title })),
    sources,
  });
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const SettingsAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    settings: z
      .object({
        workingTtlMin: z.number().int().min(10).max(1440),
        notifyDelayMin: z.number().int().min(0).max(60),
        quietStart: HHMM,
        quietEnd: HHMM,
        macosLimit: z.number().int().min(1).max(50).nullable(),
      })
      .partial()
      .strict(),
  }),
  z.object({ action: z.literal('linkTelegram') }),
  z.object({ action: z.literal('unlinkTelegram') }),
  z.object({ action: z.literal('renameProject'), projectId: z.string().min(1), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('moveRepo'), repo: z.string().min(1), projectId: z.string().min(1) }),
  z.object({ action: z.literal('assignSession'), sessionId: z.string().min(1), projectId: z.string().min(1) }),
]);

export async function handleSettingsPost(req: Request, deps: OwnerDeps): Promise<Response> {
  if (!(await deps.isOwner())) return empty(401);
  const parsed = SettingsAction.safeParse(await body(req));
  if (!parsed.success) return empty(400);
  const { store, now } = deps;
  const a = parsed.data;

  const projectExists = async (id: string) => (await store.loadSnapshot(now)).projects.some((p) => p.id === id);

  switch (a.action) {
    case 'update':
      await store.patchSettings(a.settings);
      return empty(204);
    case 'linkTelegram': {
      const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      const expiresAt = new Date(now.getTime() + LINK_CODE_MINUTES * MINUTE);
      await store.patchSettings({ telegramLinkCode: { code, expiresAt } });
      return json({ code, expiresAt });
    }
    case 'unlinkTelegram':
      await store.patchSettings({ telegramChatId: null, telegramLinkCode: null });
      return empty(204);
    case 'renameProject':
      if (!(await projectExists(a.projectId))) return empty(400);
      await store.renameProject(a.projectId, a.name);
      return empty(204);
    case 'moveRepo':
      if (!(await projectExists(a.projectId)) || !(await store.getRepo(a.repo))) return empty(400);
      await store.moveRepo(a.repo, a.projectId);
      return empty(204);
    case 'assignSession':
      if (!(await projectExists(a.projectId)) || !(await store.getSession(a.sessionId))) return empty(400);
      await store.upsertSession({ id: a.sessionId, projectId: a.projectId });
      return empty(204);
  }
}
