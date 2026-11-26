import { isWorking } from './attention';
import type { ItemKind, ItemLevel } from './attention';
import type { StoredItem } from './items';
import type { QueueRow, QueueView } from './queue';
import type { Checks, RunStatus, SessionState, Settings, Snapshot } from './types';

const MINUTE = 60_000;
const SESSION_VISIBLE_DAYS = 7;
const RUNS_PER_PROJECT = 5;
export const NO_PROJECT = 'Без проекта';

/** Mirrors SourceHealth in the store; declared here so the domain stays free of store imports. */
export interface SourceReading {
  source: string;
  lastOkAt: Date | null;
  lastErrorAt: Date | null;
  note: string | null;
}

export interface AttentionRow {
  id: string;
  level: ItemLevel;
  kind: ItemKind;
  project: string;
  text: string;
  ageMin: number;
  /** Not yet sent to Telegram: the owner has not been told about it. */
  fresh: boolean;
  sessionUrl: string | null;
  prUrl: string | null;
}

export interface SessionRow {
  id: string;
  title: string | null;
  state: SessionState;
  stateText: string;
  working: boolean;
  ageMin: number;
  url: string | null;
}

export interface PrRow {
  repo: string;
  number: number;
  title: string;
  checks: Checks;
  mergeable: boolean | null;
  draft: boolean;
  ageMin: number;
  url: string;
  ledBy: 'session' | 'none';
  sessionId: string | null;
}

export interface RunRow {
  id: number;
  repo: string;
  workflow: string;
  branch: string;
  status: RunStatus;
  conclusion: string | null;
  ageMin: number;
  url: string;
}

export interface ProjectView {
  /** null: the group of sessions that belong to no project yet. */
  id: string | null;
  name: string;
  waiting: number;
  sessions: SessionRow[];
  prs: PrRow[];
  runs: RunRow[];
}

export interface QueueRowView extends QueueRow {
  project: string;
  sessionTitle: string | null;
  sessionUrl: string | null;
  runUrl: string;
}

export interface BoardView {
  generatedAt: string;
  attention: AttentionRow[];
  snoozed: number;
  queue: Omit<QueueView, 'rows'> & { rows: QueueRowView[] };
  projects: ProjectView[];
  warnings: string[];
}

export const sessionUrl = (id: string | null): string | null =>
  id?.startsWith('session_') ? `https://claude.ai/code/${id}` : null;
const prUrl = (repo: string, number: number) => `https://github.com/${repo}/pull/${number}`;
const runUrl = (repo: string, id: number) => `https://github.com/${repo}/actions/runs/${id}`;

export function buildBoardView(
  snap: Snapshot,
  items: StoredItem[],
  queue: QueueView,
  sources: SourceReading[],
  now: Date,
  cfg: Settings,
): BoardView {
  const age = (d: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / MINUTE));
  const projectName = new Map(snap.projects.map((p) => [p.id, p.name]));
  const repoProject = new Map(snap.repos.map((r) => [r.fullName, r.projectId]));
  const nameOf = (id: string | null) => (id ? projectName.get(id) : undefined) ?? NO_PROJECT;
  const open = items.filter((i) => i.status === 'open');

  const attention = open
    .slice()
    .sort(
      (a, b) =>
        Number(a.level === 'note') - Number(b.level === 'note') ||
        Number(a.notifiedAt !== null) - Number(b.notifiedAt !== null) ||
        b.since.getTime() - a.since.getTime(),
    )
    .map(
      (i): AttentionRow => ({
        id: i.id,
        level: i.level,
        kind: i.kind,
        project: nameOf(i.projectId),
        text: i.text,
        ageMin: age(i.since),
        fresh: i.notifiedAt === null,
        sessionUrl: sessionUrl(i.sessionId),
        prUrl: i.pr ? prUrl(i.pr.repo, i.pr.number) : null,
      }),
    );

  const withItem = new Set(open.map((i) => i.sessionId).filter((id): id is string => id !== null));
  const visibleSessions = snap.sessions.filter((s) => {
    if (s.archived) return false;
    const last = Math.max(s.reportedAt?.getTime() ?? 0, s.reconcile?.updatedAt.getTime() ?? 0);
    return withItem.has(s.id) || now.getTime() - last <= SESSION_VISIBLE_DAYS * 1440 * MINUTE;
  });
  const sessionProject = (s: (typeof snap.sessions)[number]) => s.projectId ?? (s.repo ? repoProject.get(s.repo) ?? null : null);

  const buildProject = (id: string | null, name: string): ProjectView => {
    const sessions = visibleSessions
      .filter((s) => sessionProject(s) === id)
      .map((s) => ({
        row: {
          id: s.id,
          title: s.title,
          state: s.state,
          stateText: s.stateText,
          working: isWorking(s, snap.runs, now, cfg),
          ageMin: age(s.reportedAt ?? s.reconcile?.updatedAt ?? now),
          url: sessionUrl(s.id),
        } satisfies SessionRow,
      }))
      .sort((a, b) => a.row.ageMin - b.row.ageMin)
      .map((x) => x.row);

    const prs = snap.prs
      .filter((p) => p.state === 'open' && (repoProject.get(p.repo) ?? null) === id && id !== null)
      .map((p): PrRow => {
        const own = snap.sessions.filter((s) => p.sessionId === s.id || (s.repo === p.repo && s.branch === p.branch));
        const leader = own.find((s) => isWorking(s, snap.runs, now, cfg));
        return {
          repo: p.repo,
          number: p.number,
          title: p.title,
          checks: p.checks,
          mergeable: p.mergeable,
          draft: p.draft,
          ageMin: age(p.updatedAt),
          url: prUrl(p.repo, p.number),
          ledBy: leader ? 'session' : 'none',
          sessionId: leader?.id ?? p.sessionId ?? own[0]?.id ?? null,
        };
      });

    const runs = snap.runs
      .filter((r) => id !== null && repoProject.get(r.repo) === id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, RUNS_PER_PROJECT)
      .map(
        (r): RunRow => ({
          id: r.id,
          repo: r.repo,
          workflow: r.workflow,
          branch: r.branch,
          status: r.status,
          conclusion: r.conclusion,
          ageMin: age(r.createdAt),
          url: runUrl(r.repo, r.id),
        }),
      );

    return { id, name, waiting: open.filter((i) => i.projectId === id).length, sessions, prs, runs };
  };

  const projects = snap.projects
    .map((p) => buildProject(p.id, p.name))
    .sort((a, b) => Number(b.waiting > 0) - Number(a.waiting > 0) || a.name.localeCompare(b.name, 'ru'));
  const orphans = buildProject(null, NO_PROJECT);
  if (orphans.sessions.length > 0) projects.push(orphans);

  const sessionById = new Map(snap.sessions.map((s) => [s.id, s]));
  const rows = queue.rows.map(
    (r): QueueRowView => ({
      ...r,
      project: nameOf(repoProject.get(r.repo) ?? null),
      sessionTitle: r.sessionId ? sessionById.get(r.sessionId)?.title ?? null : null,
      sessionUrl: sessionUrl(r.sessionId),
      runUrl: runUrl(r.repo, r.runId),
    }),
  );

  return {
    generatedAt: now.toISOString(),
    attention,
    snoozed: items.filter((i) => i.status === 'snoozed').length,
    queue: { ...queue, rows },
    projects,
    warnings: sourceWarnings(sources, now),
  };
}

function sourceWarnings(sources: SourceReading[], now: Date): string[] {
  const by = new Map(sources.map((s) => [s.source, s]));
  const lateBy = (name: string, minutes: number) => {
    const ok = by.get(name)?.lastOkAt;
    return !ok || now.getTime() - ok.getTime() > minutes * MINUTE;
  };
  const out: string[] = [];
  const hook = by.get('github_webhook');
  if (hook?.lastErrorAt && (!hook.lastOkAt || hook.lastErrorAt.getTime() > hook.lastOkAt.getTime())) {
    out.push(`Вебхуки GitHub: ${hook.note ?? 'последняя доставка не обработана'}`);
  }
  const sessionHook = by.get('session_hook');
  if (sessionHook?.lastErrorAt && (!sessionHook.lastOkAt || sessionHook.lastErrorAt.getTime() > sessionHook.lastOkAt.getTime())) {
    out.push(`Хук сессий: ${sessionHook.note ?? 'отчёты не приходят'}`);
  }
  if (lateBy('github_resync', 60)) out.push('GitHub не сверялся больше часа — данные о PR и сборках могут быть устаревшими');
  // The hourly session reconcile is optional (a scheduled Claude session cannot list sessions,
  // so it is not set up today). Its lateness is news only where it has run before.
  if (by.get('reconcile')?.lastOkAt && lateBy('reconcile', 120)) out.push('Сверка сессий не приходила больше двух часов');
  return out;
}
