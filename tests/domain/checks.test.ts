import { describe, expect, it } from 'vitest';
import { checksFromRuns } from '@/lib/domain/checks';
import { minutesAgo, run } from '../helpers/factories';

const live = { status: 'in_progress' as const, conclusion: null, completedAt: null };

describe('checksFromRuns', () => {
  it('none without runs', () => {
    expect(checksFromRuns([])).toBe('none');
  });

  it('success when every workflow passed', () => {
    expect(checksFromRuns([run({ workflow: 'CI' }), run({ workflow: 'Lint' })])).toBe('success');
  });

  it('failure when any workflow failed or timed out', () => {
    expect(checksFromRuns([run(), run({ workflow: 'Lint', conclusion: 'failure' })])).toBe('failure');
    expect(checksFromRuns([run({ conclusion: 'timed_out' })])).toBe('failure');
  });

  it('pending while any workflow is still queued or running', () => {
    expect(checksFromRuns([run(), run({ workflow: 'Lint', ...live })])).toBe('pending');
    expect(checksFromRuns([run({ status: 'queued', conclusion: null, completedAt: null })])).toBe('pending');
  });

  it('a failure outweighs a run still in progress', () => {
    expect(checksFromRuns([run({ conclusion: 'failure' }), run({ workflow: 'Lint', ...live })])).toBe('failure');
  });

  it('a re-run replaces the earlier attempt of the same workflow', () => {
    const failed = run({ conclusion: 'failure', createdAt: minutesAgo(60) });
    expect(checksFromRuns([failed, run({ createdAt: minutesAgo(10) })])).toBe('success');
    expect(checksFromRuns([failed, run({ ...live, createdAt: minutesAgo(10) })])).toBe('pending');
  });

  it('a cancelled run is unfinished business, not a failure', () => {
    expect(checksFromRuns([run({ conclusion: 'cancelled' })])).toBe('pending');
  });

  it('skipped and neutral runs do not count; alone they are none', () => {
    expect(checksFromRuns([run({ conclusion: 'skipped' })])).toBe('none');
    expect(checksFromRuns([run(), run({ workflow: 'Docs', conclusion: 'neutral' })])).toBe('success');
  });

  it('ignores manually dispatched and scheduled runs on the same commit', () => {
    expect(checksFromRuns([run({ event: 'workflow_dispatch', conclusion: 'failure' })])).toBe('none');
    expect(checksFromRuns([run(), run({ workflow: 'Mockups', event: 'schedule', conclusion: 'failure' })])).toBe('success');
    expect(checksFromRuns([run({ event: 'pull_request' })])).toBe('success');
  });
});
