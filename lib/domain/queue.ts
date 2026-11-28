import type { Job, Run, Session, Settings } from './types';

const MINUTE = 60_000;
const HISTORY_SIZE = 10;

/** Jobs that take a slot in the account-wide macOS queue. Linux jobs never wait for one. */
export function isMacJob(labels: string[]): boolean {
  return labels.some((l) => /^(macos|xcode)/i.test(l));
}

/**
 * A run nobody needs any more: a newer commit of the same workflow on the same branch already
 * has its own run. Manual and scheduled runs are asked for explicitly and are never stale.
 */
export function isStale(run: Run, all: Run[]): boolean {
  if (run.status === 'completed') return false;
  if (run.event !== 'push' && run.event !== 'pull_request') return false;
  return all.some(
    (o) =>
      o.id !== run.id &&
      o.repo === run.repo &&
      o.workflow === run.workflow &&
      o.branch === run.branch &&
      o.headSha !== run.headSha &&
      o.createdAt.getTime() > run.createdAt.getTime(),
  );
}

/** Median duration of the most recent successful jobs, in minutes. */
export function medianDurationMin(history: Job[]): number | null {
  const durations = history
    .filter((j) => j.status === 'completed' && j.conclusion === 'success' && j.startedAt && j.completedAt)
    .sort((a, b) => (b.completedAt as Date).getTime() - (a.completedAt as Date).getTime())
    .slice(0, HISTORY_SIZE)
    .map((j) => ((j.completedAt as Date).getTime() - (j.startedAt as Date).getTime()) / MINUTE)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  const median =
    durations.length % 2 === 1
      ? (durations[mid] as number)
      : ((durations[mid - 1] as number) + (durations[mid] as number)) / 2;
  return Math.round(median);
}

/**
 * The account's concurrency limit is not documented for the runner image in use, so it is learnt:
 * whatever number of mac jobs runs while another one waits is a lower bound on it. It is read from
 * the live jobs and from the finished jobs of the last days (`history`), so a limit GitHub lowers
 * shows up within that window; with no waiting seen in it, what was known stays.
 */
export function observeLimit(live: Job[], history: Job[], prev: number | null): number | null {
  const mac = live.filter((j) => isMacJob(j.labels));
  const liveRunning = mac.filter((j) => j.status === 'in_progress').length;
  const liveSeen = mac.some((j) => j.status === 'queued') && liveRunning > 0 ? liveRunning : 0;

  const done = history.filter((j) => isMacJob(j.labels) && j.startedAt && j.completedAt);
  let pastSeen = 0;
  for (const w of done) {
    const started = (w.startedAt as Date).getTime();
    // A job that waited at least a minute: what ran just before it started was the account's fill.
    if (started - w.createdAt.getTime() < MINUTE) continue;
    const t = started - 1;
    const running = done.filter(
      (j) => j !== w && (j.startedAt as Date).getTime() <= t && (j.completedAt as Date).getTime() > t,
    ).length;
    pastSeen = Math.max(pastSeen, running);
  }

  const seen = Math.max(liveSeen, pastSeen);
  return seen > 0 ? seen : prev;
}

export interface QueueRow {
  jobId: number;
  runId: number;
  repo: string;
  workflow: string;
  branch: string;
  status: 'in_progress' | 'queued';
  stale: boolean;
  elapsedMin: number | null;
  estimateMin: number | null;
  waitingMin: number | null;
  startsInMin: number | null;
  sessionId: string | null;
  origin: 'session' | 'manual' | 'schedule' | 'push';
}

export interface QueueView {
  running: number;
  waiting: number;
  /** When one more job would start. 0: a slot is free now. null: cannot tell. */
  freeSlotInMin: number | null;
  rows: QueueRow[];
}

export function estimateQueue(
  input: { runs: Run[]; jobs: Job[]; history: Job[]; sessions: Session[] },
  now: Date,
  cfg: Settings,
): QueueView {
  const runById = new Map(input.runs.map((r) => [r.id, r]));
  const active = input.jobs.filter((j) => isMacJob(j.labels) && j.status !== 'completed');
  const minutesSince = (d: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / MINUTE));

  const estimates = new Map<string, number | null>();
  const estimateFor = (j: Job): number | null => {
    const key = `${j.repo}\n${j.name}`;
    if (!estimates.has(key)) {
      estimates.set(key, medianDurationMin(input.history.filter((h) => h.repo === j.repo && h.name === j.name)));
    }
    return estimates.get(key) ?? null;
  };

  const base = (j: Job) => {
    const run = runById.get(j.runId);
    const owner = run
      ? input.sessions.find((s) => !s.archived && s.repo === run.repo && s.branch === run.branch)
      : undefined;
    const origin: QueueRow['origin'] =
      run?.event === 'workflow_dispatch' ? 'manual' : run?.event === 'schedule' ? 'schedule' : owner ? 'session' : 'push';
    return {
      jobId: j.id,
      runId: j.runId,
      repo: j.repo,
      workflow: run?.workflow ?? j.name,
      branch: run?.branch ?? '',
      stale: run ? isStale(run, input.runs) : false,
      sessionId: origin === 'session' ? (owner?.id ?? null) : null,
      origin,
    };
  };

  const runningJobs = active
    .filter((j) => j.status === 'in_progress')
    .map((j) => ({ job: j, elapsed: minutesSince(j.startedAt ?? j.createdAt), estimate: estimateFor(j) }))
    .sort((a, b) => b.elapsed - a.elapsed);
  const queuedJobs = active
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Simulate the queue: each slot holds the minute it becomes free; Infinity means "unknown".
  const limit = cfg.macosLimit ?? cfg.observedMacosLimit;
  let slots: number[] | null = null;
  if (limit !== null) {
    slots = runningJobs.map((r) => (r.estimate === null ? Infinity : Math.max(0, r.estimate - r.elapsed)));
    for (let i = runningJobs.length; i < limit; i++) slots.push(0);
  }
  const takeSlot = (duration: number | null): number | null => {
    if (!slots || slots.length === 0) return null;
    let at = 0;
    for (let i = 1; i < slots.length; i++) if ((slots[i] as number) < (slots[at] as number)) at = i;
    const start = slots[at] as number;
    slots[at] = duration === null ? Infinity : start + duration;
    return Number.isFinite(start) ? start : null;
  };

  const rows: QueueRow[] = [
    ...runningJobs.map((r) => ({
      ...base(r.job),
      status: 'in_progress' as const,
      elapsedMin: r.elapsed,
      estimateMin: r.estimate,
      waitingMin: null,
      startsInMin: null,
    })),
    ...queuedJobs.map((j) => ({
      ...base(j),
      status: 'queued' as const,
      elapsedMin: null,
      estimateMin: estimateFor(j),
      waitingMin: minutesSince(j.createdAt),
      startsInMin: takeSlot(estimateFor(j)),
    })),
  ];

  return {
    running: runningJobs.length,
    waiting: queuedJobs.length,
    freeSlotInMin: takeSlot(null),
    rows,
  };
}
