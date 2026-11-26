import type { Checks, Run } from './types';

const FAILED = new Set(['failure', 'timed_out']);
const IGNORED = new Set(['skipped', 'neutral']);

/**
 * The state of a pull request's checks, from the workflow runs of its head commit.
 * Only runs a push or the pull request itself started count: a manually dispatched or scheduled
 * workflow can run on the same commit and says nothing about whether the change is good.
 * A re-run replaces the earlier attempt of the same workflow.
 */
export function checksFromRuns(runs: Run[]): Checks {
  const latest = new Map<string, Run>();
  for (const r of runs) {
    if (r.event !== 'push' && r.event !== 'pull_request') continue;
    const prev = latest.get(r.workflow);
    if (!prev || prev.createdAt.getTime() <= r.createdAt.getTime()) latest.set(r.workflow, r);
  }
  const counted = [...latest.values()].filter((r) => !(r.status === 'completed' && IGNORED.has(r.conclusion ?? '')));
  if (counted.length === 0) return 'none';
  if (counted.some((r) => r.status === 'completed' && FAILED.has(r.conclusion ?? ''))) return 'failure';
  // A cancelled run was usually pushed out by a newer commit; either way nothing has passed yet.
  if (counted.some((r) => r.status !== 'completed' || r.conclusion === 'cancelled')) return 'pending';
  return 'success';
}
