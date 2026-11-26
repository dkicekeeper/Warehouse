import type { PullRequest, Repo, Run, Session, Settings, Snapshot } from './types';

export type ItemKind =
  | 'session_needs_owner'
  | 'session_unknown'
  | 'session_silent'
  | 'session_reconcile'
  | 'pr_ready'
  | 'ci_failed'
  | 'main_red';

/** request: the owner was asked, or something is broken. note: the service worked it out itself. */
export type ItemLevel = 'request' | 'note';

export interface DesiredItem {
  key: string;
  kind: ItemKind;
  level: ItemLevel;
  projectId: string | null;
  text: string;
  sessionId: string | null;
  pr: { repo: string; number: number } | null;
  repo: string | null;
  since: Date;
}

const MINUTE = 60_000;

/**
 * A reconcile reading counts against a hook-reporting session only when it is clearly newer than
 * the hook report: both are written at the end of the same turn, seconds apart.
 */
const RECONCILE_GRACE_MIN = 2;

/**
 * "работаю" does not last forever: a session that said it was waiting and never came back is the
 * very thing this service exists to surface. It holds for `workingTtlMin` after the report, and
 * for as long as a run on the session's branch is still queued or running.
 */
export function isWorking(s: Session, runs: Run[], now: Date, cfg: Settings): boolean {
  if (s.state !== 'working' || s.archived) return false;
  if (s.reportedAt && now.getTime() - s.reportedAt.getTime() <= cfg.workingTtlMin * MINUTE) return true;
  return runs.some(
    (r) => r.status !== 'completed' && s.repo !== null && r.repo === s.repo && r.branch === s.branch,
  );
}

export function computeAttention(snap: Snapshot, now: Date, cfg: Settings): DesiredItem[] {
  const repoByName = new Map(snap.repos.map((r) => [r.fullName, r]));
  const items: DesiredItem[] = [];
  const sessionsWithItem = new Set<string>();

  for (const s of snap.sessions) {
    const item = sessionItem(s, snap.runs, now, cfg, repoByName);
    if (item) {
      items.push(item);
      sessionsWithItem.add(s.id);
    }
  }

  for (const p of snap.prs) {
    if (p.state !== 'open' || p.draft) continue;
    const own = snap.sessions.filter((s) => isSessionOfPr(s, p));
    // One item per cause: the session already speaks for this PR.
    if (own.some((s) => sessionsWithItem.has(s.id))) continue;
    if (own.some((s) => isWorking(s, snap.runs, now, cfg))) continue;
    const item = prItem(p, repoByName);
    if (item) items.push(item);
  }

  items.push(...mainRedItems(snap.runs, repoByName));
  return items;
}

function isSessionOfPr(s: Session, p: PullRequest): boolean {
  return p.sessionId === s.id || (s.repo === p.repo && s.branch === p.branch);
}

function sessionItem(
  s: Session,
  runs: Run[],
  now: Date,
  cfg: Settings,
  repoByName: Map<string, Repo>,
): DesiredItem | null {
  const base = {
    key: `session:${s.id}`,
    projectId: s.projectId ?? (s.repo ? repoByName.get(s.repo)?.projectId ?? null : null),
    sessionId: s.id,
    pr: null,
    repo: s.repo,
  };
  const rec = s.reconcile;
  const reported = s.reportedAt;

  if (!s.archived && reported) {
    if (s.state === 'needs_owner') {
      return { ...base, kind: 'session_needs_owner', level: 'request', text: s.stateText, since: reported };
    }
    if (s.state === 'working' && !isWorking(s, runs, now, cfg)) {
      return { ...base, kind: 'session_silent', level: 'note', text: `сессия молчит: ${s.stateText}`, since: reported };
    }
  }

  if (rec) {
    const stuck = rec.bucket === 'blocked' || rec.bucket === 'failed';
    const fresh =
      !reported || rec.updatedAt.getTime() > reported.getTime() + RECONCILE_GRACE_MIN * MINUTE;
    // A session that reports through the hook already said how its turn ended; "unread" adds
    // nothing. Only being stuck (a permission prompt, a failed turn) is news the hook cannot give.
    const relevant = s.archived
      ? rec.bucket === 'blocked'
      : reported
        ? stuck && fresh
        : stuck || (rec.bucket === 'review_ready' && rec.unread);
    if (relevant) {
      return {
        ...base,
        kind: 'session_reconcile',
        level: 'note',
        text: rec.summary ?? s.title ?? 'ждёт ответа',
        since: rec.updatedAt,
      };
    }
  }

  if (!s.archived && reported && s.state === 'unknown') {
    return { ...base, kind: 'session_unknown', level: 'note', text: `без статуса: ${s.stateText}`, since: reported };
  }
  return null;
}

function prItem(p: PullRequest, repoByName: Map<string, Repo>): DesiredItem | null {
  const base = {
    key: `pr:${p.repo}#${p.number}`,
    level: 'request' as const,
    projectId: repoByName.get(p.repo)?.projectId ?? null,
    sessionId: p.sessionId,
    pr: { repo: p.repo, number: p.number },
    repo: p.repo,
    since: p.updatedAt,
  };
  if (p.checks === 'failure') {
    return { ...base, kind: 'ci_failed', text: `PR #${p.number} ${p.title} — CI упал, никто не чинит` };
  }
  if (p.checks === 'success' && p.mergeable === true) {
    return { ...base, kind: 'pr_ready', text: `PR #${p.number} ${p.title} — готов к мержу` };
  }
  return null;
}

const RED = new Set(['failure', 'timed_out']);
const DECISIVE = new Set(['success', 'failure', 'timed_out']);

/**
 * Only push-triggered runs colour the default branch. Manually dispatched and scheduled workflows
 * (store reports, screenshots, nightly updates) also run "on main", and their failures say nothing
 * about the code that is there.
 */
function mainRedItems(runs: Run[], repoByName: Map<string, Repo>): DesiredItem[] {
  const latest = new Map<string, Run>();
  for (const r of runs) {
    const repo = repoByName.get(r.repo);
    if (!repo || r.branch !== repo.defaultBranch) continue;
    if (r.event !== 'push' || r.status !== 'completed' || !r.completedAt) continue;
    if (!r.conclusion || !DECISIVE.has(r.conclusion)) continue;
    const key = `main:${r.repo}:${r.workflow}`;
    const prev = latest.get(key);
    if (!prev || (prev.completedAt as Date).getTime() < r.completedAt.getTime()) latest.set(key, r);
  }
  const items: DesiredItem[] = [];
  for (const [key, r] of latest) {
    if (!RED.has(r.conclusion as string)) continue;
    items.push({
      key,
      kind: 'main_red',
      level: 'request',
      projectId: repoByName.get(r.repo)?.projectId ?? null,
      text: `main красный: ${r.workflow}`,
      sessionId: null,
      pr: null,
      repo: r.repo,
      since: r.completedAt as Date,
    });
  }
  return items;
}
