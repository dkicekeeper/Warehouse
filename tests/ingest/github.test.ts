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
  repositoryRenamedEvent,
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

describe('push to the default branch', () => {
  it('asks for the docs of the repository to be read again', async () => {
    await store.ensureRepo(REPO, 'main', 'Platina');
    const repo = (await store.listDocsState()).find((r) => r.repo === REPO);
    await store.replaceRepoDocs(REPO, [], 'none', NOW);
    await apply('push', pushEvent({ ref: 'refs/heads/claude/side' }));
    expect((await store.listDocsState()).find((r) => r.repo === repo!.repo)?.dirty).toBe(false);
    await apply('push', pushEvent({ ref: 'refs/heads/main' }));
    expect((await store.listDocsState()).find((r) => r.repo === repo!.repo)?.dirty).toBe(true);
  });

  it('makes «can merge» of the open PRs unknown again: main moved under them', async () => {
    await store.ensureRepo(REPO, 'main', 'Platina');
    await apply('pull_request', pullRequestEvent('opened', { mergeable: true }));
    await apply('push', pushEvent({ ref: 'refs/heads/main', after: 'ccc333' }));
    expect(await store.getPr(REPO, 3)).toMatchObject({ mergeable: null, headSha: 'aaa111' });
  });

  it('a push to another branch leaves «can merge» of other PRs as it was', async () => {
    await store.ensureRepo(REPO, 'main', 'Platina');
    await apply('pull_request', pullRequestEvent('opened', { mergeable: true }));
    await apply('push', pushEvent({ ref: 'refs/heads/claude/side', after: 'ccc333' }));
    expect(await store.getPr(REPO, 3)).toMatchObject({ mergeable: true });
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
    await apply('push', pushEvent({ ref: 'refs/heads/claude/no-pr' }));
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

describe('push before the docs migration has run', () => {
  it('still does its work on the pull request', async () => {
    await apply('pull_request', pullRequestEvent('opened', { mergeable: true }));
    const broken = Object.assign(Object.create(store), { markDocsDirty: () => Promise.reject(new Error('column "docs_dirty" does not exist')) });
    await store.ensureRepo(REPO, 'claude/infotip-a1', 'Platina');
    await applyGithubEvent(broken, 'push', pushEvent(), NOW);
    expect(await store.getPr(REPO, 3)).toMatchObject({ headSha: 'bbb222', checks: 'pending' });
  });
});

describe('a renamed repository', () => {
  const NEW = 'dkicekeeper/PSPlatina';

  async function stocked() {
    await apply('pull_request', pullRequestEvent('opened'));
    await apply('workflow_run', workflowRunEvent('completed'));
    return (await store.getRepo(REPO))!;
  }

  it('the renamed event moves its PRs and runs to the new name and keeps its project', async () => {
    const before = await stocked();
    await apply('repository', repositoryRenamedEvent('Platina', 'PSPlatina'));
    expect(await store.getRepo(REPO)).toBeNull();
    expect(await store.getRepo(NEW)).toMatchObject({ projectId: before.projectId });
    expect(await store.getPr(NEW, 3)).not.toBeNull();
    expect(await store.getRun(9001)).toMatchObject({ repo: NEW });
    const snap = await store.loadSnapshot(NOW);
    expect(snap.projects).toHaveLength(1);
  });

  it('an event under the new name before the renamed event is recognised by the repository id', async () => {
    const before = await stocked();
    const underNewName = {
      ...pullRequestEvent('opened', { number: 4, head: { ref: 'claude/x', sha: 'ddd444' } }),
      repository: repository({ full_name: NEW, name: 'PSPlatina' }),
    };
    await apply('pull_request', underNewName);
    expect(await store.getRepo(REPO)).toBeNull();
    expect(await store.getRepo(NEW)).toMatchObject({ projectId: before.projectId });
    expect(await store.getPr(NEW, 3)).not.toBeNull();
    expect(await store.getPr(NEW, 4)).not.toBeNull();
    expect((await store.loadSnapshot(NOW)).projects).toHaveLength(1);
  });

  it('a different repository with a different id stays a different repository', async () => {
    await stocked();
    await apply('installation_repositories', { action: 'added', repositories_added: [{ id: 2002, full_name: 'dkicekeeper/Other', name: 'Other' }] });
    expect(await store.getRepo(REPO)).not.toBeNull();
    expect(await store.getRepo('dkicekeeper/Other')).not.toBeNull();
  });
});
