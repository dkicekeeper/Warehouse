// Webhook bodies cut down to the fields the service reads. Shapes follow GitHub's webhook docs.

export const repository = (over: Record<string, unknown> = {}) => ({
  full_name: 'dkicekeeper/Platina',
  name: 'Platina',
  default_branch: 'main',
  ...over,
});

export const pullRequestEvent = (action: string, over: Record<string, unknown> = {}) => ({
  action,
  repository: repository(),
  pull_request: {
    number: 3,
    title: 'Add an InfoTip to trophy rarity',
    state: 'open',
    draft: false,
    merged: false,
    mergeable: null,
    head: { ref: 'claude/infotip-a1', sha: 'aaa111' },
    created_at: '2026-11-25T05:30:00Z',
    updated_at: '2026-11-25T06:00:00Z',
    ...over,
  },
});

export const workflowRunEvent = (action: string, over: Record<string, unknown> = {}) => ({
  action,
  repository: repository(),
  workflow_run: {
    id: 9001,
    name: 'iOS',
    head_branch: 'claude/infotip-a1',
    head_sha: 'aaa111',
    event: 'push',
    status: action === 'completed' ? 'completed' : action === 'in_progress' ? 'in_progress' : 'queued',
    conclusion: action === 'completed' ? 'success' : null,
    created_at: '2026-11-25T06:01:00Z',
    run_started_at: '2026-11-25T06:01:00Z',
    updated_at: '2026-11-25T06:40:00Z',
    ...over,
  },
});

export const workflowJobEvent = (action: string, over: Record<string, unknown> = {}) => ({
  action,
  repository: repository(),
  workflow_job: {
    id: 7001,
    run_id: 9001,
    name: 'build-and-test',
    labels: ['xcode-27'],
    status: action === 'completed' ? 'completed' : action === 'in_progress' ? 'in_progress' : 'queued',
    conclusion: action === 'completed' ? 'success' : null,
    created_at: '2026-11-25T06:01:05Z',
    started_at: action === 'queued' ? null : '2026-11-25T06:20:00Z',
    completed_at: action === 'completed' ? '2026-11-25T06:40:00Z' : null,
    ...over,
  },
});

export const pushEvent = (over: Record<string, unknown> = {}) => ({
  ref: 'refs/heads/claude/infotip-a1',
  after: 'bbb222',
  deleted: false,
  repository: repository(),
  ...over,
});

export const installationReposEvent = (names: string[]) => ({
  action: 'added',
  repositories_added: names.map((full_name) => ({ full_name, name: full_name.split('/')[1] })),
});
