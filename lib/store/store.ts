import type { MetricDay, MetricSource } from '@/lib/domain/metrics';
import type { DesiredItem } from '@/lib/domain/attention';
import type { ItemChanges, ItemPatch, StoredItem } from '@/lib/domain/items';
import type { ProjectDoc } from '@/lib/domain/docs';
import type { Job, Project, PullRequest, Repo, Run, Session, Settings, Snapshot } from '@/lib/domain/types';

export type SourceName =
  | 'github_webhook'
  | 'github_resync'
  | 'session_hook'
  | 'reconcile'
  | 'heartbeat'
  | 'docs_sync'
  | MetricSource;

export type PrPatch = Partial<Pick<PullRequest, 'checks' | 'headSha' | 'mergeable' | 'sessionId'>>;

export interface SourceHealth {
  source: SourceName;
  lastOkAt: Date | null;
  lastErrorAt: Date | null;
  note: string | null;
}

export interface DocsState {
  repo: string;
  defaultBranch: string;
  treeSha: string | null;
  dirty: boolean;
  syncedAt: Date | null;
}

export type SessionPatch = Partial<Omit<Session, 'id'>> & { id: string };

/** Everything the service keeps. One implementation (Postgres); tests run it on PGlite. */
export interface Store {
  /** What the rules and the board need: open PRs, live and recent runs, live jobs, current sessions. */
  loadSnapshot(now: Date): Promise<Snapshot>;
  /** Finished jobs of the last 14 days, for duration estimates. */
  loadJobHistory(now: Date): Promise<Job[]>;
  /** Every item that is not resolved. */
  loadItems(): Promise<StoredItem[]>;
  getItem(id: string): Promise<StoredItem | null>;
  getSettings(): Promise<Settings>;
  getSources(): Promise<SourceHealth[]>;
  getPr(repo: string, number: number): Promise<PullRequest | null>;
  getRun(id: number): Promise<Run | null>;
  getJob(id: number): Promise<Job | null>;
  getSession(id: string): Promise<Session | null>;
  getRepo(fullName: string): Promise<Repo | null>;
  findOpenPr(repo: string, branch: string): Promise<PullRequest | null>;
  listOpenPrsByHead(repo: string, headSha: string): Promise<PullRequest[]>;
  listRunsByHead(repo: string, headSha: string): Promise<Run[]>;

  applyItemChanges(changes: ItemChanges, now: Date): Promise<void>;
  patchItem(id: string, patch: ItemPatch): Promise<void>;
  /**
   * Takes the right to notify about these items. False when another worker holds it: two
   * recomputes may run at once, and only one of them may write to Telegram.
   */
  claimNotify(itemIds: string[], now: Date): Promise<boolean>;
  /** Gives the claim back after a failed send, so the next run may retry at once. */
  releaseNotify(itemIds: string[]): Promise<void>;
  /** Records a successful send and frees the claim. */
  markNotified(
    itemIds: string[],
    at: Date,
    messageId: number | null,
    textByItem: Record<string, string>,
  ): Promise<void>;
  patchSettings(patch: Partial<Settings>): Promise<void>;

  upsertSession(session: SessionPatch): Promise<void>;
  /**
   * Sessions without a project that a pull request names (through its commit trailers) take that
   * pull request's project, repository and branch.
   */
  adoptSessionsFromPrs(): Promise<void>;
  upsertPr(pr: PullRequest): Promise<void>;
  /**
   * Changes only the given fields of a stored PR. Writers that know one part of a PR (its checks,
   * a new head after a push, the session from a commit trailer) use this, so two of them at once
   * never overwrite each other's fields with a stale copy.
   */
  patchPr(repo: string, number: number, patch: PrPatch): Promise<void>;
  /** «Can merge» of every open PR of the repository becomes unknown: its default branch moved. */
  forgetMergeable(repo: string): Promise<void>;
  /** The stored repository with this GitHub id, under whatever name it was stored. */
  getRepoByGithubId(githubId: number): Promise<Repo | null>;
  setRepoGithubId(fullName: string, githubId: number): Promise<void>;
  /**
   * The owner renamed a repository: everything stored under the old name moves to the new one,
   * and the repository keeps its project.
   */
  renameRepo(from: string, to: string): Promise<void>;
  upsertRun(run: Run): Promise<void>;
  upsertJob(job: Job): Promise<void>;
  /** Registers a repository; a repository nobody has seen gets a project named `projectName`. */
  ensureRepo(fullName: string, defaultBranch: string, projectName: string): Promise<Repo>;
  renameProject(id: string, name: string): Promise<void>;
  /** Moves a repository to another project and drops the project it leaves if that is now empty. */
  moveRepo(fullName: string, projectId: string): Promise<void>;

  /** Every record of the project standard read so far, all repositories. */
  listDocs(): Promise<ProjectDoc[]>;
  listRepoDocs(repo: string): Promise<ProjectDoc[]>;
  /** The whole set a repository holds now: what is not in it is gone. Clears the "read again" mark. */
  replaceRepoDocs(repo: string, docs: ProjectDoc[], treeSha: string, now: Date): Promise<void>;
  /** Asks for the repository's docs to be read at the next tick; `false` takes the request back. */
  markDocsDirty(repo: string, dirty?: boolean): Promise<void>;
  listDocsState(): Promise<DocsState[]>;

  touchSource(source: SourceName, at: Date, ok: boolean, note?: string | null): Promise<void>;
  /** Writes days of metrics; a day already stored for the same app, source and metric is replaced. */
  upsertMetricDays(rows: MetricDay[]): Promise<void>;
  /** Every stored day from `from` (YYYY-MM-DD) on. */
  loadMetricDays(from: string): Promise<MetricDay[]>;
  /** The first and last day a source has data for. */
  metricCoverage(source: MetricSource): Promise<{ earliest: string | null; latest: string | null }>;
  /** The earliest day a source has been read back to (YYYY-MM-DD), or null before its first collection. */
  getMetricBackfill(source: MetricSource): Promise<string | null>;
  setMetricBackfill(source: MetricSource, from: string): Promise<void>;
  recordEvent(source: SourceName, deliveryId: string, payload: unknown, now: Date): Promise<'new' | 'duplicate'>;
  /** Forgets a delivery whose apply failed, so the sender's retry is applied, not dropped as a duplicate. */
  forgetEvent(source: SourceName, deliveryId: string): Promise<void>;
  pruneEvents(olderThan: Date): Promise<void>;
}

export type { DesiredItem, ItemChanges, ItemPatch, StoredItem, Project };
