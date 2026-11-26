import type { BacklogSummary, TaskRow } from './backlog';
import type { ItemKind } from './attention';
import type { AttentionRow, BoardView, ProjectView } from './board';
import type { MacHistory } from './mac-history';

/**
 * The overview page arranged from what /api/board sends: one list of everything that waits for
 * the owner (the service's items and the tasks the projects' docs mark), the four numbers at the
 * top, and a card per project.
 */

export type BoardResponse = BoardView & { backlog?: BacklogSummary; macBuilds?: MacHistory };

export type InboxTab = 'sessions' | 'prs' | 'tasks';

export interface InboxRow {
  key: string;
  tab: InboxTab;
  /** request: asked or broken; note: the service worked it out; task: a backlog task. */
  level: 'request' | 'note' | 'task';
  project: string;
  title: string;
  sub: string | null;
  kind: string;
  /** How long a service item has waited, in minutes; null for a task. */
  ageMin: number | null;
  /** Days since a task's `updated` day; null for a service item or a task without a date. */
  ageDays: number | null;
  item?: AttentionRow;
  task?: TaskRow;
}

export const KIND_LABEL: Record<ItemKind, string> = {
  session_needs_owner: 'просьба сессии',
  session_unknown: 'без статуса',
  session_silent: 'сессия молчит',
  session_reconcile: 'заметка',
  pr_ready: 'PR готов',
  ci_failed: 'CI упал',
  main_red: 'main красный',
};

const tabOf = (kind: ItemKind): InboxTab => (kind.startsWith('session_') ? 'sessions' : 'prs');

/** Whole days from a task's `updated` day to today's (UTC) date; null without a readable day. */
function daysSince(day: string | null, now: Date): number | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((today - at) / 86_400_000));
}

export function buildInbox(board: BoardResponse, now: Date): InboxRow[] {
  const items: InboxRow[] = board.attention.map((a) => ({
    key: `item:${a.id}`,
    tab: tabOf(a.kind),
    level: a.level,
    project: a.project,
    title: a.text,
    sub: null,
    kind: KIND_LABEL[a.kind] ?? a.kind,
    ageMin: a.ageMin,
    ageDays: null,
    item: a,
  }));
  const tasks: InboxRow[] = (board.backlog?.ownerTasks ?? []).map((t) => ({
    key: `task:${t.repo}/${t.id}`,
    tab: 'tasks',
    level: 'task',
    project: t.project,
    title: t.title,
    sub: t.needsOwner ? `Нужно от вас: ${t.needsOwner}` : null,
    kind: 'задача',
    ageMin: null,
    ageDays: daysSince(t.updated, now),
    task: t,
  }));
  // Requests first, then the tasks (they wait for days, not minutes), then the notes.
  const order = { request: 0, task: 1, note: 2 } as const;
  return [...items, ...tasks].sort((a, b) => order[a.level] - order[b.level]);
}

export interface Kpis {
  requests: number;
  ownerTasks: number;
  sessionsWorking: number;
  sessionsSilent: number;
  queueRunning: number;
  queueWaiting: number;
  freeSlotInMin: number | null;
  openTasks: number;
  inProgress: number;
  ready: number;
}

export function kpis(board: BoardResponse): Kpis {
  const sessions = board.projects.flatMap((p) => p.sessions);
  const counts = Object.values(board.backlog?.byProject ?? {});
  const sum = (f: (c: (typeof counts)[number]) => number) => counts.reduce((n, c) => n + f(c), 0);
  return {
    requests: board.attention.filter((a) => a.level === 'request').length,
    ownerTasks: board.backlog?.ownerTasks.length ?? 0,
    sessionsWorking: sessions.filter((s) => s.state === 'working' && s.working).length,
    sessionsSilent: sessions.filter((s) => s.state === 'working' && !s.working).length,
    queueRunning: board.queue.running,
    queueWaiting: board.queue.waiting,
    freeSlotInMin: board.queue.freeSlotInMin,
    openTasks: sum((c) => c.open),
    inProgress: sum((c) => c.inProgress),
    ready: sum((c) => c.ready),
  };
}

export interface TaskSegments {
  needsOwner: number;
  inProgress: number;
  ready: number;
  ideas: number;
  other: number;
}

export interface ProjectCard {
  id: string | null;
  name: string;
  stage: string | null;
  /** What waits for the owner here: requests from sessions and broken CI, by the board's items. */
  requests: number;
  broken: boolean;
  segments: TaskSegments | null;
  openTasks: number;
  sessions: number;
  sessionsWorking: number;
  prs: number;
  /** Minutes since the newest session, PR or build; null when nothing happened. */
  lastActivityMin: number | null;
}

export function projectCards(board: BoardResponse): ProjectCard[] {
  const byProject = board.backlog?.byProject ?? {};
  return board.projects.map((p: ProjectView) => {
    const mine = board.attention.filter((a) => a.project === p.name);
    const docs = p.id ? byProject[p.id] : undefined;
    const ages = [...p.sessions, ...p.prs, ...p.runs].map((x) => x.ageMin);
    return {
      id: p.id,
      name: p.name,
      stage: docs?.stage ?? null,
      requests: mine.filter((a) => a.level === 'request').length,
      broken: mine.some((a) => a.kind === 'ci_failed' || a.kind === 'main_red'),
      segments: docs
        ? {
            needsOwner: docs.needsOwner,
            inProgress: docs.inProgress,
            ready: docs.ready,
            ideas: docs.ideas,
            other: Math.max(0, docs.open - docs.needsOwner - docs.inProgress - docs.ready - docs.ideas),
          }
        : null,
      openTasks: docs?.open ?? 0,
      sessions: p.sessions.length,
      sessionsWorking: p.sessions.filter((s) => s.state === 'working' && s.working).length,
      prs: p.prs.length,
      lastActivityMin: ages.length > 0 ? Math.min(...ages) : null,
    };
  });
}

/** The session and PR an item points at, found by their addresses in the board's projects. */
export function relatedOf(board: BoardResponse, item: AttentionRow) {
  const project = board.projects.find((p) => p.name === item.project) ?? null;
  const session = item.sessionUrl ? (project?.sessions.find((s) => s.url === item.sessionUrl) ?? null) : null;
  const pr = item.prUrl ? (project?.prs.find((x) => x.url === item.prUrl) ?? null) : null;
  return { project, session, pr };
}
