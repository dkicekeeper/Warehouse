import type { DesiredItem, ItemKind, ItemLevel } from '@/lib/domain/attention';
import type { ItemChanges, ItemPatch, ItemStatus, StoredItem } from '@/lib/domain/items';
import {
  DEFAULT_SETTINGS,
  type Checks,
  type Job,
  type Project,
  type PullRequest,
  type ReconcileBucket,
  type Repo,
  type Run,
  type RunStatus,
  type Session,
  type SessionState,
  type Settings,
  type Snapshot,
} from '@/lib/domain/types';
import type { DocsState, SessionPatch, SourceHealth, SourceName, Store } from './store';
import type { DocKind, ProjectDoc } from '@/lib/domain/docs';

/** The one thing the store needs from a Postgres driver. */
export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements with no parameters and no result (migrations). */
  exec(text: string): Promise<void>;
}

type Row = Record<string, unknown>;

// Values cross the driver boundary in forms every driver agrees on: timestamps as ISO strings
// cast in SQL; arrays and JSON as text cast `::text::jsonb`. The double cast matters: with a bare
// `::jsonb` postgres.js sees a jsonb parameter and JSON-encodes the already-encoded string, so the
// server receives a string scalar instead of the array. bigint comes back as a string from some drivers.
const ts = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const date = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
const must = (v: unknown): Date => date(v) as Date;
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const toSession = (r: Row): Session => ({
  id: String(r.id),
  projectId: str(r.project_id),
  repo: str(r.repo),
  branch: str(r.branch),
  title: str(r.title),
  state: r.state as SessionState,
  stateText: String(r.state_text),
  reportedAt: date(r.reported_at),
  archived: Boolean(r.archived),
  reconcile: r.rec_bucket
    ? {
        bucket: r.rec_bucket as ReconcileBucket,
        unread: Boolean(r.rec_unread),
        summary: str(r.rec_summary),
        updatedAt: must(r.rec_updated_at),
      }
    : null,
});

const toPr = (r: Row): PullRequest => ({
  repo: String(r.repo),
  number: num(r.number),
  title: String(r.title),
  branch: String(r.branch),
  headSha: String(r.head_sha),
  state: r.state as PullRequest['state'],
  draft: Boolean(r.draft),
  mergeable: r.mergeable === null || r.mergeable === undefined ? null : Boolean(r.mergeable),
  checks: r.checks as Checks,
  openedAt: must(r.opened_at),
  updatedAt: must(r.updated_at),
  sessionId: str(r.session_id),
});

const toRun = (r: Row): Run => ({
  id: num(r.id),
  repo: String(r.repo),
  workflow: String(r.workflow),
  branch: String(r.branch),
  headSha: String(r.head_sha),
  event: String(r.event),
  status: r.status as RunStatus,
  conclusion: str(r.conclusion),
  createdAt: must(r.created_at),
  startedAt: date(r.started_at),
  completedAt: date(r.completed_at),
});

const toJob = (r: Row): Job => ({
  id: num(r.id),
  runId: num(r.run_id),
  repo: String(r.repo),
  name: String(r.name),
  labels: (r.labels as string[] | null) ?? [],
  status: r.status as RunStatus,
  conclusion: str(r.conclusion),
  createdAt: must(r.created_at),
  startedAt: date(r.started_at),
  completedAt: date(r.completed_at),
});

const toItem = (r: Row): StoredItem => ({
  id: String(r.id),
  key: String(r.key),
  kind: r.kind as ItemKind,
  level: r.level as ItemLevel,
  projectId: str(r.project_id),
  text: String(r.text),
  sessionId: str(r.session_id),
  pr: r.pr_repo ? { repo: String(r.pr_repo), number: num(r.pr_number) } : null,
  repo: str(r.repo),
  since: must(r.since),
  status: r.status as ItemStatus,
  firstSeenAt: must(r.first_seen_at),
  snoozedUntil: date(r.snoozed_until),
  dismissedText: str(r.dismissed_text),
  notifiedAt: date(r.notified_at),
  notifiedText: str(r.notified_text),
  telegramMessageId: r.telegram_message_id === null || r.telegram_message_id === undefined ? null : num(r.telegram_message_id),
  resolvedAt: date(r.resolved_at),
});

const toDoc = (r: Row): ProjectDoc => ({
  repo: String(r.repo),
  path: String(r.path),
  kind: String(r.kind) as DocKind,
  id: String(r.doc_id),
  title: r.title == null ? null : String(r.title),
  status: r.status == null ? null : String(r.status),
  fields: (typeof r.fields === 'string' ? JSON.parse(r.fields) : r.fields) as Record<string, unknown>,
  body: String(r.body),
  blobSha: String(r.blob_sha),
});

const toRepo = (r: Row): Repo => ({
  fullName: String(r.full_name),
  projectId: String(r.project_id),
  defaultBranch: String(r.default_branch),
});

const TIMESTAMP_COLUMNS = new Set([
  'reported_at',
  'rec_updated_at',
  'snoozed_until',
  'notified_at',
  'resolved_at',
  'last_digest_at',
  'telegram_link_expires_at',
  'sessions_valid_after',
]);

/** `col = $n` assignments for a dynamic update, casting timestamps. */
function assignments(cols: Record<string, unknown>, offset = 0): { sets: string[]; values: unknown[] } {
  const names = Object.keys(cols);
  return {
    sets: names.map((c, i) => `${c} = $${i + 1 + offset}${TIMESTAMP_COLUMNS.has(c) ? '::timestamptz' : ''}`),
    values: names.map((c) => (cols[c] instanceof Date ? ts(cols[c] as Date) : cols[c])),
  };
}

function sessionColumns(s: SessionPatch): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if ('projectId' in s) c.project_id = s.projectId;
  if ('repo' in s) c.repo = s.repo;
  if ('branch' in s) c.branch = s.branch;
  if ('title' in s) c.title = s.title;
  if ('state' in s) c.state = s.state;
  if ('stateText' in s) c.state_text = s.stateText;
  if ('reportedAt' in s) c.reported_at = s.reportedAt ?? null;
  if ('archived' in s) c.archived = s.archived;
  if ('reconcile' in s) {
    c.rec_bucket = s.reconcile?.bucket ?? null;
    c.rec_unread = s.reconcile?.unread ?? null;
    c.rec_summary = s.reconcile?.summary ?? null;
    c.rec_updated_at = s.reconcile?.updatedAt ?? null;
  }
  return c;
}

function itemColumns(p: ItemPatch): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if ('status' in p) c.status = p.status;
  if ('text' in p) c.text = p.text;
  if ('kind' in p) c.kind = p.kind;
  if ('level' in p) c.level = p.level;
  if ('projectId' in p) c.project_id = p.projectId;
  if ('sessionId' in p) c.session_id = p.sessionId;
  if ('snoozedUntil' in p) c.snoozed_until = p.snoozedUntil ?? null;
  if ('dismissedText' in p) c.dismissed_text = p.dismissedText;
  if ('notifiedAt' in p) c.notified_at = p.notifiedAt ?? null;
  if ('resolvedAt' in p) c.resolved_at = p.resolvedAt ?? null;
  return c;
}

function settingsColumns(p: Partial<Settings>): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if ('workingTtlMin' in p) c.working_ttl_min = p.workingTtlMin;
  if ('notifyDelayMin' in p) c.notify_delay_min = p.notifyDelayMin;
  if ('quietStart' in p) c.quiet_start = p.quietStart;
  if ('quietEnd' in p) c.quiet_end = p.quietEnd;
  if ('timezone' in p) c.timezone = p.timezone;
  if ('macosLimit' in p) c.macos_limit = p.macosLimit;
  if ('observedMacosLimit' in p) c.observed_macos_limit = p.observedMacosLimit;
  if ('telegramChatId' in p) c.telegram_chat_id = p.telegramChatId;
  if ('lastDigestAt' in p) c.last_digest_at = p.lastDigestAt ?? null;
  if ('sessionsValidAfter' in p) c.sessions_valid_after = p.sessionsValidAfter ?? null;
  if ('telegramLinkCode' in p) {
    c.telegram_link_code = p.telegramLinkCode?.code ?? null;
    c.telegram_link_expires_at = p.telegramLinkCode?.expiresAt ?? null;
  }
  return c;
}

const IDS = 'select jsonb_array_elements_text($1::text::jsonb)';

export class PgStore implements Store {
  constructor(private readonly sql: Sql) {}

  async loadSnapshot(now: Date): Promise<Snapshot> {
    const n = ts(now);
    const [projects, repos, sessions, prs, runs, jobs] = await Promise.all([
      this.sql.query('select id, name from projects order by created_at, id'),
      this.sql.query('select * from repos order by full_name'),
      this.sql.query(
        `select * from sessions
          where (not archived or rec_bucket = 'blocked')
            and (state = 'needs_owner'
                 or greatest(reported_at, rec_updated_at) > $1::timestamptz - interval '30 days')`,
        [n],
      ),
      this.sql.query(`select * from pull_requests where state = 'open' order by repo, number`),
      this.sql.query(
        `select * from runs
          where status <> 'completed' or created_at > $1::timestamptz - interval '24 hours'
         union
         select r.* from runs r
           join repos p on p.full_name = r.repo and p.default_branch = r.branch
          where r.event = 'push' and r.status = 'completed'
            and r.created_at > $1::timestamptz - interval '14 days'`,
        [n],
      ),
      this.sql.query(`select * from jobs where status <> 'completed'`),
    ]);
    return {
      projects: projects.map((r): Project => ({ id: String(r.id), name: String(r.name) })),
      repos: repos.map(toRepo),
      sessions: sessions.map(toSession),
      prs: prs.map(toPr),
      runs: runs.map(toRun),
      jobs: jobs.map(toJob),
    };
  }

  async loadJobHistory(now: Date): Promise<Job[]> {
    const rows = await this.sql.query(
      `select * from jobs where status = 'completed' and completed_at > $1::timestamptz - interval '14 days'`,
      [ts(now)],
    );
    return rows.map(toJob);
  }

  async loadItems(): Promise<StoredItem[]> {
    return (await this.sql.query(`select * from items where status <> 'resolved' order by first_seen_at, id`)).map(toItem);
  }

  async getItem(id: string): Promise<StoredItem | null> {
    const [r] = await this.sql.query('select * from items where id = $1', [id]);
    return r ? toItem(r) : null;
  }

  async getSettings(): Promise<Settings> {
    const [r] = await this.sql.query('select * from settings where id = 1');
    if (!r) return DEFAULT_SETTINGS;
    return {
      workingTtlMin: num(r.working_ttl_min),
      notifyDelayMin: num(r.notify_delay_min),
      quietStart: String(r.quiet_start),
      quietEnd: String(r.quiet_end),
      timezone: String(r.timezone),
      macosLimit: r.macos_limit === null ? null : num(r.macos_limit),
      observedMacosLimit: r.observed_macos_limit === null ? null : num(r.observed_macos_limit),
      telegramChatId: str(r.telegram_chat_id),
      lastDigestAt: date(r.last_digest_at),
      telegramLinkCode: r.telegram_link_code
        ? { code: String(r.telegram_link_code), expiresAt: must(r.telegram_link_expires_at) }
        : null,
      sessionsValidAfter: date(r.sessions_valid_after),
    };
  }

  async getSources(): Promise<SourceHealth[]> {
    const rows = await this.sql.query('select * from sources order by source');
    return rows.map((r) => ({
      source: r.source as SourceName,
      lastOkAt: date(r.last_ok_at),
      lastErrorAt: date(r.last_error_at),
      note: str(r.note),
    }));
  }

  async getPr(repo: string, number: number): Promise<PullRequest | null> {
    const [r] = await this.sql.query('select * from pull_requests where repo = $1 and number = $2', [repo, number]);
    return r ? toPr(r) : null;
  }

  async getRun(id: number): Promise<Run | null> {
    const [r] = await this.sql.query('select * from runs where id = $1', [id]);
    return r ? toRun(r) : null;
  }

  async getJob(id: number): Promise<Job | null> {
    const [r] = await this.sql.query('select * from jobs where id = $1', [id]);
    return r ? toJob(r) : null;
  }

  async getSession(id: string): Promise<Session | null> {
    const [r] = await this.sql.query('select * from sessions where id = $1', [id]);
    return r ? toSession(r) : null;
  }

  async getRepo(fullName: string): Promise<Repo | null> {
    const [r] = await this.sql.query('select * from repos where full_name = $1', [fullName]);
    return r ? toRepo(r) : null;
  }

  async findOpenPr(repo: string, branch: string): Promise<PullRequest | null> {
    const [r] = await this.sql.query(
      `select * from pull_requests where repo = $1 and branch = $2 and state = 'open' order by number desc limit 1`,
      [repo, branch],
    );
    return r ? toPr(r) : null;
  }

  async listOpenPrsByHead(repo: string, headSha: string): Promise<PullRequest[]> {
    const rows = await this.sql.query(
      `select * from pull_requests where repo = $1 and head_sha = $2 and state = 'open' order by number`,
      [repo, headSha],
    );
    return rows.map(toPr);
  }

  async listRunsByHead(repo: string, headSha: string): Promise<Run[]> {
    const rows = await this.sql.query('select * from runs where repo = $1 and head_sha = $2 order by created_at, id', [
      repo,
      headSha,
    ]);
    return rows.map(toRun);
  }

  async applyItemChanges(changes: ItemChanges, now: Date): Promise<void> {
    for (const d of changes.insert) await this.insertItem(d, now);
    for (const u of changes.update) await this.patchItem(u.id, u.patch);
  }

  private async insertItem(d: DesiredItem, now: Date): Promise<void> {
    // Two recomputes can race to the same conclusion; the second insert is simply dropped.
    await this.sql.query(
      `insert into items (key, kind, level, project_id, text, session_id, pr_repo, pr_number, repo, since, first_seen_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)
       on conflict (key) where status <> 'resolved' do nothing`,
      [d.key, d.kind, d.level, d.projectId, d.text, d.sessionId, d.pr?.repo ?? null, d.pr?.number ?? null, d.repo, ts(d.since), ts(now)],
    );
  }

  async patchItem(id: string, patch: ItemPatch): Promise<void> {
    const cols = itemColumns(patch);
    if (Object.keys(cols).length === 0) return;
    const { sets, values } = assignments(cols, 1);
    await this.sql.query(`update items set ${sets.join(', ')} where id = $1`, [id, ...values]);
  }

  async claimNotify(itemIds: string[], now: Date): Promise<boolean> {
    if (itemIds.length === 0) return true;
    const free = `(notify_claimed_at is null or notify_claimed_at < $2::timestamptz - interval '2 minutes')`;
    const [r] = await this.sql.query(
      `with ids as (${IDS} as id),
            ok as (select count(*) = (select count(*) from ids) as all_free
                     from items where id in (select id from ids) and ${free}),
            upd as (update items set notify_claimed_at = $2::timestamptz
                     where id in (select id from ids) and (select all_free from ok) and ${free}
                 returning id)
       select count(*)::int as n from upd`,
      [JSON.stringify(itemIds), ts(now)],
    );
    return num(r?.n) === itemIds.length;
  }

  async releaseNotify(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    await this.sql.query(`update items set notify_claimed_at = null where id in (${IDS})`, [JSON.stringify(itemIds)]);
  }

  async markNotified(
    itemIds: string[],
    at: Date,
    messageId: number | null,
    textByItem: Record<string, string>,
  ): Promise<void> {
    for (const id of itemIds) {
      await this.sql.query(
        `update items set notified_at = $2::timestamptz, telegram_message_id = $3, notified_text = $4,
                notify_claimed_at = null where id = $1`,
        [id, ts(at), messageId, textByItem[id] ?? null],
      );
    }
  }

  async patchSettings(patch: Partial<Settings>): Promise<void> {
    const cols = settingsColumns(patch);
    if (Object.keys(cols).length === 0) return;
    const { sets, values } = assignments(cols);
    await this.sql.query(`update settings set ${sets.join(', ')} where id = 1`, values);
  }

  async upsertSession(s: SessionPatch): Promise<void> {
    const cols = sessionColumns(s);
    const names = Object.keys(cols);
    if (names.length === 0) {
      await this.sql.query('insert into sessions (id) values ($1) on conflict (id) do nothing', [s.id]);
      return;
    }
    const cast = (c: string) => (TIMESTAMP_COLUMNS.has(c) ? '::timestamptz' : '');
    const values = names.map((c) => (cols[c] instanceof Date ? ts(cols[c] as Date) : cols[c]));
    await this.sql.query(
      `insert into sessions (id, ${names.join(', ')})
       values ($1, ${names.map((c, i) => `$${i + 2}${cast(c)}`).join(', ')})
       on conflict (id) do update set ${names.map((c) => `${c} = excluded.${c}`).join(', ')}`,
      [s.id, ...values],
    );
  }

  async adoptSessionsFromPrs(): Promise<void> {
    await this.sql.query(
      `update sessions s
          set project_id = r.project_id,
              repo = coalesce(s.repo, pr.repo),
              branch = coalesce(s.branch, pr.branch)
         from pull_requests pr
         join repos r on r.full_name = pr.repo
        where pr.session_id = s.id and s.project_id is null`,
    );
  }

  async upsertPr(p: PullRequest): Promise<void> {
    await this.sql.query(
      `insert into pull_requests (repo, number, title, branch, head_sha, state, draft, mergeable, checks, opened_at, updated_at, session_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12)
       on conflict (repo, number) do update set
         title = excluded.title, branch = excluded.branch, head_sha = excluded.head_sha, state = excluded.state,
         draft = excluded.draft, mergeable = excluded.mergeable, checks = excluded.checks,
         opened_at = excluded.opened_at, updated_at = excluded.updated_at, session_id = excluded.session_id`,
      [p.repo, p.number, p.title, p.branch, p.headSha, p.state, p.draft, p.mergeable, p.checks, ts(p.openedAt), ts(p.updatedAt), p.sessionId],
    );
  }

  async upsertRun(r: Run): Promise<void> {
    await this.sql.query(
      `insert into runs (id, repo, workflow, branch, head_sha, event, status, conclusion, created_at, started_at, completed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::timestamptz)
       on conflict (id) do update set
         repo = excluded.repo, workflow = excluded.workflow, branch = excluded.branch, head_sha = excluded.head_sha,
         event = excluded.event, status = excluded.status, conclusion = excluded.conclusion,
         created_at = excluded.created_at, started_at = excluded.started_at, completed_at = excluded.completed_at`,
      [r.id, r.repo, r.workflow, r.branch, r.headSha, r.event, r.status, r.conclusion, ts(r.createdAt), ts(r.startedAt), ts(r.completedAt)],
    );
  }

  async upsertJob(j: Job): Promise<void> {
    await this.sql.query(
      `insert into jobs (id, run_id, repo, name, labels, status, conclusion, created_at, started_at, completed_at)
       values ($1, $2, $3, $4, array(select jsonb_array_elements_text($5::text::jsonb)), $6, $7,
               $8::timestamptz, $9::timestamptz, $10::timestamptz)
       on conflict (id) do update set
         run_id = excluded.run_id, repo = excluded.repo, name = excluded.name, labels = excluded.labels,
         status = excluded.status, conclusion = excluded.conclusion, created_at = excluded.created_at,
         started_at = excluded.started_at, completed_at = excluded.completed_at`,
      [j.id, j.runId, j.repo, j.name, JSON.stringify(j.labels), j.status, j.conclusion, ts(j.createdAt), ts(j.startedAt), ts(j.completedAt)],
    );
  }

  async ensureRepo(fullName: string, defaultBranch: string, projectName: string): Promise<Repo> {
    const existing = await this.getRepo(fullName);
    if (existing) {
      if (existing.defaultBranch !== defaultBranch) {
        await this.sql.query('update repos set default_branch = $2 where full_name = $1', [fullName, defaultBranch]);
      }
      return { ...existing, defaultBranch };
    }
    const [p] = await this.sql.query('insert into projects (name) values ($1) returning id', [projectName]);
    const projectId = String(p?.id);
    await this.sql.query(
      'insert into repos (full_name, project_id, default_branch) values ($1, $2, $3) on conflict (full_name) do nothing',
      [fullName, projectId, defaultBranch],
    );
    return (await this.getRepo(fullName)) as Repo;
  }

  async renameProject(id: string, name: string): Promise<void> {
    await this.sql.query('update projects set name = $2 where id = $1', [id, name]);
  }

  async moveRepo(fullName: string, projectId: string): Promise<void> {
    const repo = await this.getRepo(fullName);
    if (!repo || repo.projectId === projectId) return;
    await this.sql.query('update repos set project_id = $2 where full_name = $1', [fullName, projectId]);
    const [left] = await this.sql.query('select count(*)::int as n from repos where project_id = $1', [repo.projectId]);
    if (num(left?.n) > 0) return;
    // The old project is empty: what belonged to it follows the repository.
    await this.sql.query('update sessions set project_id = $2 where project_id = $1', [repo.projectId, projectId]);
    await this.sql.query('update items set project_id = $2 where project_id = $1', [repo.projectId, projectId]);
    await this.sql.query('delete from projects where id = $1', [repo.projectId]);
  }

  async listDocs(): Promise<ProjectDoc[]> {
    return (await this.sql.query('select * from project_docs order by repo, path')).map(toDoc);
  }

  async listRepoDocs(repo: string): Promise<ProjectDoc[]> {
    return (await this.sql.query('select * from project_docs where repo = $1 order by path', [repo])).map(toDoc);
  }

  async replaceRepoDocs(repo: string, docs: ProjectDoc[], treeSha: string, now: Date): Promise<void> {
    // One statement, so a reader never sees half a repository.
    await this.sql.query(
      `with incoming as (
         select * from jsonb_to_recordset($2::text::jsonb)
           as x(path text, kind text, doc_id text, title text, status text, fields jsonb, body text, blob_sha text)
       ), gone as (
         delete from project_docs d where d.repo = $1 and not exists (select 1 from incoming i where i.path = d.path)
       ), put as (
         insert into project_docs (repo, path, kind, doc_id, title, status, fields, body, blob_sha)
         select $1, path, kind, doc_id, title, status, coalesce(fields, '{}'::jsonb), coalesce(body, ''), blob_sha from incoming
         on conflict (repo, path) do update set kind = excluded.kind, doc_id = excluded.doc_id, title = excluded.title,
           status = excluded.status, fields = excluded.fields, body = excluded.body, blob_sha = excluded.blob_sha
       )
       update repos set docs_tree_sha = $3, docs_dirty = false, docs_synced_at = $4::timestamptz where full_name = $1`,
      [
        repo,
        JSON.stringify(
          docs.map((d) => ({
            path: d.path, kind: d.kind, doc_id: d.id, title: d.title, status: d.status, fields: d.fields, body: d.body, blob_sha: d.blobSha,
          })),
        ),
        treeSha,
        ts(now),
      ],
    );
  }

  async markDocsDirty(repo: string, dirty = true): Promise<void> {
    await this.sql.query('update repos set docs_dirty = $2 where full_name = $1', [repo, dirty]);
  }

  async listDocsState(): Promise<DocsState[]> {
    const rows = await this.sql.query('select full_name, default_branch, docs_tree_sha, docs_dirty, docs_synced_at from repos order by full_name');
    return rows.map((r) => ({
      repo: String(r.full_name),
      defaultBranch: String(r.default_branch),
      treeSha: r.docs_tree_sha == null ? null : String(r.docs_tree_sha),
      dirty: r.docs_dirty === true,
      syncedAt: r.docs_synced_at == null ? null : new Date(r.docs_synced_at as string),
    }));
  }

  async touchSource(source: SourceName, at: Date, ok: boolean, note: string | null = null): Promise<void> {
    const col = ok ? 'last_ok_at' : 'last_error_at';
    await this.sql.query(
      `insert into sources (source, ${col}, note) values ($1, $2::timestamptz, $3)
       on conflict (source) do update set ${col} = excluded.${col}, note = excluded.note`,
      [source, ts(at), note],
    );
  }

  async recordEvent(source: SourceName, deliveryId: string, payload: unknown, now: Date): Promise<'new' | 'duplicate'> {
    const rows = await this.sql.query(
      `insert into events (source, delivery_id, payload, received_at) values ($1, $2, $3::text::jsonb, $4::timestamptz)
       on conflict (source, delivery_id) do nothing returning delivery_id`,
      [source, deliveryId, JSON.stringify(payload ?? null), ts(now)],
    );
    return rows.length > 0 ? 'new' : 'duplicate';
  }

  async pruneEvents(olderThan: Date): Promise<void> {
    await this.sql.query('delete from events where received_at < $1::timestamptz', [ts(olderThan)]);
  }
}
