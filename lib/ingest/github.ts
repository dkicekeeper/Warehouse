import { z } from 'zod';
import { checksFromRuns } from '@/lib/domain/checks';
import type { Job, PullRequest, Run, RunStatus } from '@/lib/domain/types';
import type { Store } from '@/lib/store/store';

// The same objects arrive in webhooks and from the REST API, so one set of readers serves both.

const Repository = z.object({
  full_name: z.string(),
  name: z.string().optional(),
  default_branch: z.string().optional(),
});

export const GithubPr = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean().optional(),
  merged: z.boolean().nullish(),
  merged_at: z.string().nullish(),
  mergeable: z.boolean().nullish(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  created_at: z.string(),
  updated_at: z.string(),
});

export const GithubRun = z.object({
  id: z.number().int(),
  name: z.string().nullish(),
  head_branch: z.string().nullish(),
  head_sha: z.string(),
  event: z.string(),
  status: z.string().nullish(),
  conclusion: z.string().nullish(),
  created_at: z.string(),
  run_started_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});

export const GithubJob = z.object({
  id: z.number().int(),
  run_id: z.number().int(),
  name: z.string(),
  labels: z.array(z.string()).optional(),
  status: z.string(),
  conclusion: z.string().nullish(),
  created_at: z.string().nullish(),
  started_at: z.string().nullish(),
  completed_at: z.string().nullish(),
});

const RANK: Record<RunStatus, number> = { queued: 0, in_progress: 1, completed: 2 };

/** GitHub also reports requested, waiting and pending; all of them mean "not started". */
const toStatus = (s: string | null | undefined): RunStatus =>
  s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'queued';

const when = (s: string | null | undefined): Date | null => (s ? new Date(s) : null);

export async function registerRepo(store: Store, repo: z.infer<typeof Repository>): Promise<void> {
  const name = repo.name ?? repo.full_name.split('/')[1] ?? repo.full_name;
  const known = await store.getRepo(repo.full_name);
  await store.ensureRepo(repo.full_name, repo.default_branch ?? known?.defaultBranch ?? 'main', name);
}

/**
 * Stores a pull request as GitHub describes it. Events can arrive late and out of order, so a
 * description older than the stored one is dropped.
 */
export async function savePr(store: Store, repo: string, raw: unknown): Promise<PullRequest | null> {
  const parsed = GithubPr.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const updatedAt = new Date(p.updated_at);
  const existing = await store.getPr(repo, p.number);
  if (existing && existing.updatedAt.getTime() > updatedAt.getTime()) return existing;

  const sameHead = existing?.headSha === p.head.sha;
  const pr: PullRequest = {
    repo,
    number: p.number,
    title: p.title,
    branch: p.head.ref,
    headSha: p.head.sha,
    state: p.merged || p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed',
    draft: p.draft ?? false,
    mergeable: p.mergeable ?? (sameHead ? existing?.mergeable ?? null : null),
    checks: checksFromRuns(await store.listRunsByHead(repo, p.head.sha)),
    openedAt: new Date(p.created_at),
    updatedAt,
    sessionId: existing?.sessionId ?? null,
  };
  await store.upsertPr(pr);
  return pr;
}

/** Stores a run without ever moving it backwards (completed → in progress → queued). */
export async function saveRun(store: Store, repo: string, raw: unknown): Promise<Run | null> {
  const parsed = GithubRun.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const status = toStatus(r.status);
  const existing = await store.getRun(r.id);
  const startedAt = when(r.run_started_at);
  // A re-run keeps the run id and starts over; only that may move a run backwards.
  const rerun = !!(existing?.startedAt && startedAt && startedAt.getTime() > existing.startedAt.getTime());
  if (existing && !rerun && RANK[existing.status] > RANK[status]) return existing;
  const run: Run = {
    id: r.id,
    repo,
    workflow: r.name ?? 'workflow',
    branch: r.head_branch ?? '',
    headSha: r.head_sha,
    event: r.event,
    status,
    conclusion: status === 'completed' ? r.conclusion ?? null : null,
    createdAt: new Date(r.created_at),
    startedAt,
    completedAt: status === 'completed' ? when(r.updated_at) : null,
  };
  await store.upsertRun(run);
  await refreshPrChecks(store, repo, run.headSha);
  return run;
}

export async function saveJob(store: Store, repo: string, raw: unknown, now: Date): Promise<Job | null> {
  const parsed = GithubJob.safeParse(raw);
  if (!parsed.success) return null;
  const j = parsed.data;
  const status = toStatus(j.status);
  const existing = await store.getJob(j.id);
  if (existing && RANK[existing.status] > RANK[status]) return existing;
  const job: Job = {
    id: j.id,
    runId: j.run_id,
    repo,
    name: j.name,
    labels: j.labels ?? [],
    status,
    conclusion: status === 'completed' ? j.conclusion ?? null : null,
    createdAt: when(j.created_at) ?? existing?.createdAt ?? now,
    startedAt: status === 'queued' ? null : when(j.started_at),
    completedAt: status === 'completed' ? when(j.completed_at) : null,
  };
  await store.upsertJob(job);
  return job;
}

async function refreshPrChecks(store: Store, repo: string, headSha: string): Promise<void> {
  const prs = await store.listOpenPrsByHead(repo, headSha);
  if (prs.length === 0) return;
  const checks = checksFromRuns(await store.listRunsByHead(repo, headSha));
  for (const pr of prs) {
    if (pr.checks !== checks) await store.patchPr(repo, pr.number, { checks });
  }
}

const PushEvent = z.object({
  ref: z.string(),
  after: z.string(),
  deleted: z.boolean().optional(),
  repository: Repository,
});

const InstallationRepos = z.object({
  repositories: z.array(Repository).optional(),
  repositories_added: z.array(Repository).optional(),
});

/**
 * Applies one GitHub webhook. Unknown events and bodies missing what the service needs are
 * ignored: GitHub sends many shapes, and a surprise must not turn into a failed delivery.
 */
export async function applyGithubEvent(store: Store, event: string, payload: unknown, now: Date): Promise<void> {
  const body = z.object({ repository: Repository.optional() }).passthrough().safeParse(payload);
  if (!body.success) return;
  const repository = body.data.repository;
  const data = body.data as Record<string, unknown>;

  if (event === 'installation' || event === 'installation_repositories') {
    const list = InstallationRepos.safeParse(payload);
    if (!list.success) return;
    for (const r of [...(list.data.repositories ?? []), ...(list.data.repositories_added ?? [])]) {
      await registerRepo(store, r);
    }
    return;
  }

  if (!repository) return;
  const repo = repository.full_name;

  switch (event) {
    case 'pull_request': {
      if (!GithubPr.safeParse(data.pull_request).success) return;
      await registerRepo(store, repository);
      await savePr(store, repo, data.pull_request);
      return;
    }
    case 'workflow_run': {
      if (!GithubRun.safeParse(data.workflow_run).success) return;
      await registerRepo(store, repository);
      await saveRun(store, repo, data.workflow_run);
      return;
    }
    case 'workflow_job': {
      if (!GithubJob.safeParse(data.workflow_job).success) return;
      await registerRepo(store, repository);
      await saveJob(store, repo, data.workflow_job, now);
      return;
    }
    case 'push': {
      const push = PushEvent.safeParse(payload);
      if (!push.success || push.data.deleted || !push.data.ref.startsWith('refs/heads/')) return;
      const branch = push.data.ref.slice('refs/heads/'.length);
      // A push to the default branch may have changed the project's docs: read them at the next tick.
      const known = await store.getRepo(repo);
      // Never at the price of the push itself: the half-hourly full read covers a mark that failed.
      if (known && known.defaultBranch === branch) {
        await store.markDocsDirty(repo).catch(() => {});
        // GitHub computes «can merge» lazily and does not resend it when the base moves: until the
        // resync reads each PR again, it is unknown, and no PR shows «готов к мержу» on a stale value.
        await store.forgetMergeable(repo);
      }
      const pr = await store.findOpenPr(repo, branch);
      if (!pr || pr.headSha === push.data.after) return;
      // The pull_request event with the details follows; until then nothing about the new head is known.
      await store.patchPr(repo, pr.number, { headSha: push.data.after, mergeable: null, checks: 'pending' });
      return;
    }
    default:
      return;
  }
}
