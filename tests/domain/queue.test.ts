import { describe, expect, it } from 'vitest';
import { estimateQueue, isMacJob, isStale, medianDurationMin, observeLimit } from '@/lib/domain/queue';
import { DEFAULT_SETTINGS, type Job, type Run } from '@/lib/domain/types';
import { NOW, job, minutesAgo, run, session } from '../helpers/factories';

const CFG2 = { ...DEFAULT_SETTINGS, macosLimit: 2 };

/** A finished successful job that took `min` minutes, `ago` minutes ago. */
const past = (min: number, ago: number, over: Partial<Job> = {}) =>
  job({ startedAt: minutesAgo(ago + min), completedAt: minutesAgo(ago), ...over });

/** A run and its single mac job, in the given state. */
function active(
  status: 'queued' | 'in_progress',
  o: { runningFor?: number; waitingFor?: number; run?: Partial<Run>; job?: Partial<Job> } = {},
) {
  const r = run({ status, conclusion: null, completedAt: null, startedAt: null, ...o.run });
  const j = job({
    runId: r.id,
    repo: r.repo,
    status,
    conclusion: null,
    completedAt: null,
    createdAt: minutesAgo(o.waitingFor ?? (o.runningFor ?? 0) + 1),
    startedAt: status === 'in_progress' ? minutesAgo(o.runningFor ?? 0) : null,
    ...o.job,
  });
  return { run: r, job: j };
}

describe('isMacJob', () => {
  it('recognises macOS and Xcode runner labels', () => {
    expect(isMacJob(['xcode-27'])).toBe(true);
    expect(isMacJob(['macos-latest'])).toBe(true);
    expect(isMacJob(['self-hosted', 'macOS'])).toBe(true);
    expect(isMacJob(['ubuntu-latest'])).toBe(false);
    expect(isMacJob([])).toBe(false);
  });
});

describe('isStale', () => {
  const old = run({ id: 1, status: 'queued', conclusion: null, headSha: 'a', createdAt: minutesAgo(30) });

  it('is stale when a newer commit of the same workflow and branch has a run', () => {
    const newer = run({ id: 2, headSha: 'b', createdAt: minutesAgo(5) });
    expect(isStale(old, [old, newer])).toBe(true);
    expect(isStale({ ...old, status: 'in_progress' }, [old, newer])).toBe(true);
  });

  it('the only run of a branch is never stale', () => {
    expect(isStale(old, [old])).toBe(false);
  });

  it('a re-run of the same commit does not make it stale', () => {
    expect(isStale(old, [old, run({ id: 2, headSha: 'a', createdAt: minutesAgo(5) })])).toBe(false);
  });

  it('an older run of another commit does not make it stale', () => {
    expect(isStale(old, [old, run({ id: 2, headSha: 'b', createdAt: minutesAgo(90) })])).toBe(false);
  });

  it('other workflows, branches and repos do not count', () => {
    const base = { id: 2, headSha: 'b', createdAt: minutesAgo(5) };
    expect(isStale(old, [old, run({ ...base, workflow: 'Mockups' })])).toBe(false);
    expect(isStale(old, [old, run({ ...base, branch: 'claude/y' })])).toBe(false);
    expect(isStale(old, [old, run({ ...base, repo: 'o/other' })])).toBe(false);
  });

  it('completed runs, and manual or scheduled runs, are never stale', () => {
    const newer = run({ id: 2, headSha: 'b', createdAt: minutesAgo(5) });
    expect(isStale({ ...old, status: 'completed' }, [newer])).toBe(false);
    expect(isStale({ ...old, event: 'workflow_dispatch' }, [newer])).toBe(false);
    expect(isStale({ ...old, event: 'schedule' }, [newer])).toBe(false);
    expect(isStale({ ...old, event: 'pull_request' }, [newer])).toBe(true);
  });
});

describe('medianDurationMin', () => {
  it('is null without history', () => {
    expect(medianDurationMin([])).toBeNull();
  });

  it('takes the median of successful jobs', () => {
    expect(medianDurationMin([past(38, 300), past(40, 200), past(90, 100)])).toBe(40);
    expect(medianDurationMin([past(40, 200), past(44, 100)])).toBe(42);
  });

  it('uses only the 10 most recent', () => {
    const recent = Array.from({ length: 10 }, (_, i) => past(40, 10 + i));
    const ancient = Array.from({ length: 10 }, (_, i) => past(5, 5000 + i));
    expect(medianDurationMin([...ancient, ...recent])).toBe(40);
  });

  it('ignores failed, cancelled and unfinished jobs', () => {
    const jobs = [
      past(40, 100),
      past(2, 50, { conclusion: 'failure' }),
      past(1, 40, { conclusion: 'cancelled' }),
      job({ status: 'in_progress', conclusion: null, completedAt: null }),
    ];
    expect(medianDurationMin(jobs)).toBe(40);
  });
});

describe('observeLimit', () => {
  const running = (n: number) => Array.from({ length: n }, () => active('in_progress').job);
  const queued = active('queued').job;

  it('learns the limit from what runs while something waits', () => {
    expect(observeLimit([...running(3), queued], null)).toBe(3);
  });

  it('only grows', () => {
    expect(observeLimit([...running(2), queued], 5)).toBe(5);
    expect(observeLimit([...running(5), queued], 2)).toBe(5);
  });

  it('learns nothing when nothing waits, or when nothing runs', () => {
    expect(observeLimit(running(4), null)).toBeNull();
    expect(observeLimit(running(4), 2)).toBe(2);
    expect(observeLimit([queued], null)).toBeNull();
  });

  it('ignores linux jobs', () => {
    const linux = active('in_progress', { job: { labels: ['ubuntu-latest'] } }).job;
    expect(observeLimit([linux, linux, ...running(1), queued], null)).toBe(1);
  });
});

describe('estimateQueue', () => {
  const history = [past(40, 300), past(40, 200)];

  it('L=2: 22 and 9 min left, three ~40 min jobs waiting → start in 9, 22, 49; a free slot in 62', () => {
    const a = active('in_progress', { runningFor: 18, run: { branch: 'a' } });
    const b = active('in_progress', { runningFor: 31, run: { branch: 'b' } });
    const q = [30, 20, 10].map((w, i) => active('queued', { waitingFor: w, run: { branch: `q${i}` } }));
    const view = estimateQueue(
      { runs: [a.run, b.run, ...q.map((x) => x.run)], jobs: [a.job, b.job, ...q.map((x) => x.job)], history, sessions: [] },
      NOW,
      CFG2,
    );
    expect(view.running).toBe(2);
    expect(view.waiting).toBe(3);
    expect(view.rows.map((r) => r.status)).toEqual(['in_progress', 'in_progress', 'queued', 'queued', 'queued']);
    expect(view.rows.slice(0, 2).map((r) => [r.branch, r.elapsedMin, r.estimateMin])).toEqual([
      ['b', 31, 40],
      ['a', 18, 40],
    ]);
    expect(view.rows.slice(2).map((r) => [r.branch, r.waitingMin, r.startsInMin])).toEqual([
      ['q0', 30, 9],
      ['q1', 20, 22],
      ['q2', 10, 49],
    ]);
    expect(view.freeSlotInMin).toBe(62);
  });

  it('a free slot now means 0, and the first waiting job starts now', () => {
    const a = active('in_progress', { runningFor: 10 });
    const q = active('queued', { waitingFor: 1, run: { branch: 'q' } });
    const view = estimateQueue({ runs: [a.run, q.run], jobs: [a.job, q.job], history, sessions: [] }, NOW, CFG2);
    expect(view.rows[1]?.startsInMin).toBe(0);
    expect(view.freeSlotInMin).toBe(30);
  });

  it('an empty queue has a free slot now', () => {
    expect(estimateQueue({ runs: [], jobs: [], history, sessions: [] }, NOW, CFG2)).toEqual({
      running: 0,
      waiting: 0,
      freeSlotInMin: 0,
      rows: [],
    });
  });

  it('a job running past its estimate is treated as about to finish, not as negative time', () => {
    const a = active('in_progress', { runningFor: 70 });
    const b = active('in_progress', { runningFor: 55, run: { branch: 'b' } });
    const q = active('queued', { waitingFor: 5, run: { branch: 'q' } });
    const view = estimateQueue(
      { runs: [a.run, b.run, q.run], jobs: [a.job, b.job, q.job], history, sessions: [] },
      NOW,
      CFG2,
    );
    expect(view.rows[2]?.startsInMin).toBe(0);
  });

  it('gives null, not a guess, when the limit is unknown', () => {
    const a = active('in_progress', { runningFor: 18 });
    const q = active('queued', { waitingFor: 5, run: { branch: 'q' } });
    const view = estimateQueue({ runs: [a.run, q.run], jobs: [a.job, q.job], history, sessions: [] }, NOW, DEFAULT_SETTINGS);
    expect(view.rows[0]?.estimateMin).toBe(40);
    expect(view.rows[1]?.startsInMin).toBeNull();
    expect(view.freeSlotInMin).toBeNull();
  });

  it('falls back to the observed limit when none is set by hand', () => {
    const a = active('in_progress', { runningFor: 18 });
    const q = active('queued', { waitingFor: 5, run: { branch: 'q' } });
    const cfg = { ...DEFAULT_SETTINGS, observedMacosLimit: 1 };
    const view = estimateQueue({ runs: [a.run, q.run], jobs: [a.job, q.job], history, sessions: [] }, NOW, cfg);
    expect(view.rows[1]?.startsInMin).toBe(22);
  });

  it('gives null for a job with no history and for everything queued behind it', () => {
    const a = active('in_progress', { runningFor: 18 });
    const noHist = active('queued', { waitingFor: 9, run: { branch: 'n' }, job: { name: 'screenshots' } });
    const q = active('queued', { waitingFor: 5, run: { branch: 'q' } });
    const cfg = { ...DEFAULT_SETTINGS, macosLimit: 1 };
    const view = estimateQueue(
      { runs: [a.run, noHist.run, q.run], jobs: [a.job, noHist.job, q.job], history, sessions: [] },
      NOW,
      cfg,
    );
    expect(view.rows.map((r) => r.startsInMin)).toEqual([null, 22, null]);
    expect(view.freeSlotInMin).toBeNull();
  });

  it('estimates per repository and job name', () => {
    const a = active('in_progress', { runningFor: 5, run: { repo: 'o/dalada' }, job: { name: 'ios' } });
    const hist = [...history, past(12, 100, { repo: 'o/dalada', name: 'ios' })];
    const view = estimateQueue({ runs: [a.run], jobs: [a.job], history: hist, sessions: [] }, NOW, CFG2);
    expect(view.rows[0]?.estimateMin).toBe(12);
  });

  it('excludes linux jobs from rows and counts', () => {
    const linux = active('in_progress', { job: { labels: ['ubuntu-latest'] } });
    const view = estimateQueue({ runs: [linux.run], jobs: [linux.job], history, sessions: [] }, NOW, CFG2);
    expect(view).toMatchObject({ running: 0, waiting: 0, rows: [] });
  });

  it('marks stale rows and names where each run came from', () => {
    const s = session({ repo: 'o/r', branch: 'claude/paywall' });
    const stale = active('queued', { waitingFor: 40, run: { branch: 'claude/paywall', headSha: 'a', createdAt: minutesAgo(40) } });
    const fresh = active('queued', { waitingFor: 5, run: { branch: 'claude/paywall', headSha: 'b', createdAt: minutesAgo(5) } });
    const manual = active('queued', { waitingFor: 3, run: { branch: 'main', event: 'workflow_dispatch', workflow: 'TestFlight' } });
    const nightly = active('queued', { waitingFor: 2, run: { branch: 'main', event: 'schedule', workflow: 'DesignKit' } });
    const loose = active('queued', { waitingFor: 1, run: { branch: 'feature/by-hand' } });
    const all = [stale, fresh, manual, nightly, loose];
    const view = estimateQueue(
      { runs: all.map((x) => x.run), jobs: all.map((x) => x.job), history, sessions: [s] },
      NOW,
      CFG2,
    );
    expect(view.rows.map((r) => [r.workflow, r.stale, r.origin, r.sessionId])).toEqual([
      ['CI', true, 'session', s.id],
      ['CI', false, 'session', s.id],
      ['TestFlight', false, 'manual', null],
      ['DesignKit', false, 'schedule', null],
      ['CI', false, 'push', null],
    ]);
  });

  it('does not attribute a run to an archived session', () => {
    const s = session({ repo: 'o/r', branch: 'claude/x', archived: true });
    const q = active('queued');
    const view = estimateQueue({ runs: [q.run], jobs: [q.job], history, sessions: [s] }, NOW, CFG2);
    expect(view.rows[0]).toMatchObject({ origin: 'push', sessionId: null });
  });
});
