import { beforeEach, describe, expect, it } from 'vitest';
import { applyGithubEvent } from '@/lib/ingest/github';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW } from '../helpers/factories';
import {
  installationReposEvent,
  pullRequestEvent,
  pushEvent,
  repository,
  workflowJobEvent,
  workflowRunEvent,
} from '../fixtures/github';

const REPO = 'dkicekeeper/Platina';
let store: PgStore;
beforeEach(async () => {
  ({ store } = await testStore());
});
const apply = (event: string, payload: unknown) => applyGithubEvent(store, event, payload, NOW);

describe('pull_request', () => {
  it('opened → an open PR with its branch, head and dates', async () => {
    await apply('pull_request', pullRequestEvent('opened'));
    expect(await store.getPr(REPO, 3)).toEqual({
      repo: REPO,
      number: 3,
      title: 'Add an InfoTip to trophy rarity',
      branch: 'claude/infotip-a1',
      headSha: 'aaa111',
      state: 'open',
      draft: false,
      mergeable: null,
      checks: 'none',
      openedAt: new Date('2026-11-25T05:30:00Z'),
      updatedAt: new Date('2026-11-25T06:00:00Z'),
      sessionId: null,
    });
  });

  it('registers the repository with its default branch and a project named after it', async () => {
    await apply('pull_request', pullRequestEvent('opened'));
    const snap = await store.loadSnapshot(NOW);
    expect(snap.repos).toMatchObject([{ fullName: REPO, defaultBranch: 'main' }]);
    expect(snap.projects.map((p) => p.name)).toEqual(['Platina']);
  });

  it('closed with merged=true is merged; closed without is closed', async () => {
    await apply('pull_request', pullRequestEvent('closed', { state: 'closed', merged: true, updated_at: '2026-11-25T07:00:00Z' }));
    expect((await store.getPr(REPO, 3))?.state).toBe('merged');
    await apply('pull_request', pullRequestEvent('closed', { number: 4, state: 'closed' }));
    expect((await store.getPr(REPO, 4))?.state).toBe('closed');
  });

  it('a closed PR is not reopened by an older event arriving late', async () => {
    await apply('pull_request', pullRequestEvent('closed', { state: 'closed', merged: true, updated_at: '2026-11-25T07:00:00Z' }));
    await apply('pull_request', pullRequestEvent('synchronize', { updated_at: '2026-11-25T06:30:00Z' }));
    expect((await store.getPr(REPO, 3))?.state).toBe('merged');
  });

  it('a genuinely newer reopened event does reopen it', async () => {
    await apply('pull_request', pullRequestEvent('closed', { state: 'closed', updated_at: '2026-11-25T07:00:00Z' }));
    await apply('pull_request', pullRequestEvent('reopened', { updated_at: '2026-11-25T08:00:00Z' }));
    expect((await store.getPr(REPO, 3))?.state).toBe('open');
  });

  it('keeps what GitHub did not resend: mergeable for the same head, and the linked session', async () => {
    await apply('pull_request', pullRequestEvent('opened', { mergeable: true }));
    const stored = await store.getPr(REPO, 3);
    await store.upsertPr({ ...stored!, sessionId: 'session_a' });
    await apply('pull_request', pullRequestEvent('edited', { title: 'New title', updated_at: '2026-11-25T06:10:00Z' }));
    expect(await store.getPr(REPO, 3)).toMatchObject({ title: 'New title', mergeable: true, sessionId: 'session_a' });
  });

  it('a new head forgets mergeable and takes its checks from the runs of that commit', async () => {
    await apply('pull_request', pullRequestEvent('opened', { mergeable: true }));
    await apply('workflow_run', workflowRunEvent('completed', { id: 9002, head_sha: 'bbb222', conclusion: 'failure' }));
    await apply(
      'pull_request',
      pullRequestEvent('synchronize', { head: { ref: 'claude/infotip-a1', sha: 'bbb222' }, updated_at: '2026-11-25T06:10:00Z' }),
    );
    expect(await store.getPr(REPO, 3)).toMatchObject({ headSha: 'bbb222', mergeable: null, checks: 'failure' });
  });

  it('draft and ready-for-review follow the payload', async () => {
    await apply('pull_request', pullRequestEvent('opened', { draft: true }));
    expect((await store.getPr(REPO, 3))?.draft).toBe(true);
    await apply('pull_request', pullRequestEvent('ready_for_review', { draft: false, updated_at: '2026-11-25T06:10:00Z' }));
    expect((await store.getPr(REPO, 3))?.draft).toBe(false);
  });
});

describe('workflow_run', () => {
  it('maps a run through queued, in progress and completed', async () => {
    await apply('workflow_run', workflowRunEvent('requested'));
    expect(await store.getRun(9001)).toMatchObject({ status: 'queued', conclusion: null, completedAt: null, workflow: 'iOS', event: 'push' });
    await apply('workflow_run', workflowRunEvent('in_progress'));
    expect((await store.getRun(9001))?.status).toBe('in_progress');
    await apply('workflow_run', workflowRunEvent('completed'));
    expect(await store.getRun(9001)).toMatchObject({
      status: 'completed',
      conclusion: 'success',
      branch: 'claude/infotip-a1',
      headSha: 'aaa111',
      createdAt: new Date('2026-11-25T06:01:00Z'),
      completedAt: new Date('2026-11-25T06:40:00Z'),
    });
  });

  it('completed delivered before in_progress stays completed', async () => {
    await apply('workflow_run', workflowRunEvent('completed'));
    await apply('workflow_run', workflowRunEvent('in_progress'));
    await apply('workflow_run', workflowRunEvent('requested'));
    expect(await store.getRun(9001)).toMatchObject({ status: 'completed', conclusion: 'success' });
  });

  it('waiting and pending statuses count as queued', async () => {
    await apply('workflow_run', workflowRunEvent('requested', { status: 'waiting' }));
    expect((await store.getRun(9001))?.status).toBe('queued');
  });

  it('updates the checks of the open PR on that commit', async () => {
    await apply('pull_request', pullRequestEvent('opened'));
    await apply('workflow_run', workflowRunEvent('in_progress'));
    expect((await store.getPr(REPO, 3))?.checks).toBe('pending');
    await apply('workflow_run', workflowRunEvent('completed'));
    expect((await store.getPr(REPO, 3))?.checks).toBe('success');
  });

  it('a run of an older commit does not touch the PR', async () => {
    await apply('pull_request', pullRequestEvent('opened'));
    await apply('workflow_run', workflowRunEvent('completed', { head_sha: 'old000', conclusion: 'failure' }));
    expect((await store.getPr(REPO, 3))?.checks).toBe('none');
  });

  it('a run with no branch (a tag, a detached ref) is stored with an empty branch', async () => {
    await apply('workflow_run', workflowRunEvent('completed', { head_branch: null }));
    expect((await store.getRun(9001))?.branch).toBe('');
  });
});

describe('workflow_job', () => {
  it('maps labels, times and status', async () => {
    await apply('workflow_job', workflowJobEvent('queued'));
    expect(await store.getJob(7001)).toEqual({
      id: 7001,
      runId: 9001,
      repo: REPO,
      name: 'build-and-test',
      labels: ['xcode-27'],
      status: 'queued',
      conclusion: null,
      createdAt: new Date('2026-11-25T06:01:05Z'),
      startedAt: null,
      completedAt: null,
    });
    await apply('workflow_job', workflowJobEvent('in_progress'));
    await apply('workflow_job', workflowJobEvent('completed'));
    expect(await store.getJob(7001)).toMatchObject({
      status: 'completed',
      conclusion: 'success',
      startedAt: new Date('2026-11-25T06:20:00Z'),
      completedAt: new Date('2026-11-25T06:40:00Z'),
    });
  });

  it('completed delivered before in_progress stays completed', async () => {
    await apply('workflow_job', workflowJobEvent('completed'));
    await apply('workflow_job', workflowJobEvent('in_progress'));
    await apply('workflow_job', workflowJobEvent('queued'));
    expect(await store.getJob(7001)).toMatchObject({ status: 'completed', completedAt: new Date('2026-11-25T06:40:00Z') });
  });

  it('applying the same event twice changes nothing', async () => {
    await apply('workflow_job', workflowJobEvent('in_progress'));
    const first = await store.getJob(7001);
    await apply('workflow_job', workflowJobEvent('in_progress'));
    expect(await store.getJob(7001)).toEqual(first);
  });
});

describe('push', () => {
  it('to a branch with an open PR resets mergeable and marks checks pending', async () => {
    await apply('pull_request', pullRequestEvent('opened', { mergeable: true }));
    await apply('push', pushEvent());
    expect(await store.getPr(REPO, 3)).toMatchObject({ headSha: 'bbb222', mergeable: null, checks: 'pending' });
  });

  it('with the head the PR already has changes nothing', async () => {
    await apply('pull_request', pullRequestEvent('opened', { mergeable: true }));
    await apply('push', pushEvent({ after: 'aaa111' }));
    expect(await store.getPr(REPO, 3)).toMatchObject({ mergeable: true, checks: 'none' });
  });

  it('that deletes the branch, or goes to a branch without a PR, is ignored', async () => {
    await apply('pull_request', pullRequestEvent('opened', { mergeable: true }));
    await apply('push', pushEvent({ deleted: true, after: '0000000000000000000000000000000000000000' }));
    await apply('push', pushEvent({ ref: 'refs/heads/main' }));
    await apply('push', pushEvent({ ref: 'refs/tags/v1.0' }));
    expect(await store.getPr(REPO, 3)).toMatchObject({ headSha: 'aaa111', mergeable: true });
  });
});

describe('installation', () => {
  it('each added repository gets a project named after it', async () => {
    await apply('installation_repositories', installationReposEvent(['dkicekeeper/Tenra', 'dkicekeeper/Dalada']));
    const snap = await store.loadSnapshot(NOW);
    expect(snap.projects.map((p) => p.name).sort()).toEqual(['Dalada', 'Tenra']);
  });

  it('an installation event lists its repositories under `repositories`', async () => {
    await apply('installation', { action: 'created', repositories: [{ full_name: 'dkicekeeper/DesignKit', name: 'DesignKit' }] });
    expect((await store.loadSnapshot(NOW)).repos.map((r) => r.fullName)).toEqual(['dkicekeeper/DesignKit']);
  });
});

describe('robustness', () => {
  it('ignores events it does not know', async () => {
    await expect(apply('star', { action: 'created', repository: repository() })).resolves.toBeUndefined();
  });

  it('ignores a known event whose body is missing what it needs', async () => {
    await expect(apply('pull_request', { action: 'opened' })).resolves.toBeUndefined();
    await expect(apply('workflow_job', { workflow_job: { id: 'x' }, repository: repository() })).resolves.toBeUndefined();
    await expect(apply('workflow_run', null)).resolves.toBeUndefined();
    expect((await store.loadSnapshot(NOW)).prs).toEqual([]);
  });
});

describe('re-runs', () => {
  it('a completed run that is started again moves back to in progress', async () => {
    await apply('workflow_run', workflowRunEvent('completed', { conclusion: 'failure' }));
    await apply(
      'workflow_run',
      workflowRunEvent('in_progress', { run_started_at: '2026-11-25T07:00:00Z', updated_at: '2026-11-25T07:00:05Z' }),
    );
    expect(await store.getRun(9001)).toMatchObject({ status: 'in_progress', conclusion: null, completedAt: null });
  });
});
