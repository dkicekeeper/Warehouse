import { randomUUID } from 'node:crypto';
import type { Sql } from './pg';

/**
 * The database schema, as ordered migrations. They live in code so that the deployed service can
 * bring its own database up to date (the minute tick does it) with nothing to run by hand.
 * A migration is never edited after it has shipped; changes go into a new one.
 */
export interface Migration {
  name: string;
  sql: string;
}

const SCHEMA = `-- Warehouse dispatch board: state kept by the service.
-- Only the server reads and writes these tables, over a direct Postgres connection.
-- Row level security is on with no policies, so the public (PostgREST) keys see nothing.

create table projects (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  created_at timestamptz not null default now()
);

create table repos (
  full_name text primary key,
  project_id text not null references projects (id),
  default_branch text not null default 'main'
);

create table sessions (
  id text primary key,
  project_id text references projects (id) on delete set null,
  repo text,
  branch text,
  title text,
  state text not null default 'unknown' check (state in ('needs_owner', 'working', 'done', 'unknown')),
  state_text text not null default '',
  reported_at timestamptz,
  archived boolean not null default false,
  rec_bucket text check (rec_bucket in ('working', 'blocked', 'review_ready', 'completed', 'failed')),
  rec_unread boolean,
  rec_summary text,
  rec_updated_at timestamptz
);

create table pull_requests (
  repo text not null,
  number integer not null,
  title text not null,
  branch text not null,
  head_sha text not null,
  state text not null check (state in ('open', 'closed', 'merged')),
  draft boolean not null default false,
  mergeable boolean,
  checks text not null default 'none' check (checks in ('none', 'pending', 'success', 'failure')),
  opened_at timestamptz not null,
  updated_at timestamptz not null,
  session_id text,
  primary key (repo, number)
);
create index pull_requests_open on pull_requests (repo, branch) where state = 'open';

create table runs (
  id bigint primary key,
  repo text not null,
  workflow text not null,
  branch text not null,
  head_sha text not null,
  event text not null,
  status text not null check (status in ('queued', 'in_progress', 'completed')),
  conclusion text,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz
);
create index runs_head on runs (repo, head_sha);
create index runs_live on runs (status) where status <> 'completed';

create table jobs (
  id bigint primary key,
  run_id bigint not null,
  repo text not null,
  name text not null,
  labels text[] not null default '{}',
  status text not null check (status in ('queued', 'in_progress', 'completed')),
  conclusion text,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz
);
create index jobs_live on jobs (status) where status <> 'completed';

create table items (
  id text primary key default gen_random_uuid()::text,
  key text not null,
  kind text not null,
  level text not null check (level in ('request', 'note')),
  project_id text references projects (id) on delete set null,
  text text not null,
  session_id text,
  pr_repo text,
  pr_number integer,
  repo text,
  since timestamptz not null,
  status text not null default 'open' check (status in ('open', 'snoozed', 'dismissed', 'resolved')),
  first_seen_at timestamptz not null,
  snoozed_until timestamptz,
  dismissed_text text,
  notified_at timestamptz,
  notified_text text,
  telegram_message_id bigint,
  notify_claimed_at timestamptz,
  resolved_at timestamptz
);
-- One live item per cause.
create unique index items_live_key on items (key) where status <> 'resolved';

create table settings (
  id integer primary key default 1 check (id = 1),
  working_ttl_min integer not null default 120,
  notify_delay_min integer not null default 5,
  quiet_start text not null default '23:00',
  quiet_end text not null default '08:00',
  timezone text not null default 'Asia/Almaty',
  macos_limit integer,
  observed_macos_limit integer,
  telegram_chat_id text,
  last_digest_at timestamptz,
  telegram_link_code text,
  telegram_link_expires_at timestamptz
);
insert into settings (id) values (1);

create table sources (
  source text primary key,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  note text
);

create table events (
  source text not null,
  delivery_id text not null,
  payload jsonb,
  received_at timestamptz not null,
  primary key (source, delivery_id)
);
create index events_received on events (received_at);

alter table projects enable row level security;
alter table repos enable row level security;
alter table sessions enable row level security;
alter table pull_requests enable row level security;
alter table runs enable row level security;
alter table jobs enable row level security;
alter table items enable row level security;
alter table settings enable row level security;
alter table sources enable row level security;
alter table events enable row level security;
`;

const SEED_PROJECTS = `-- Projects whose name differs from their repository, or that span several repositories.
-- Everything else is created on its own, named after the repository, when the GitHub App reports it.

with p as (insert into projects (name) values ('Baja.kz') returning id)
insert into repos (full_name, project_id) select 'dkicekeeper/AutoParts4x4', id from p
on conflict (full_name) do nothing;

with p as (insert into projects (name) values ('Tenra') returning id)
insert into repos (full_name, project_id)
select r, p.id from p, (values ('dkicekeeper/Tenra'), ('dkicekeeper/tenra-assets')) as t (r)
on conflict (full_name) do nothing;
`;

const SESSIONS_VALID_AFTER = `
alter table settings add column sessions_valid_after timestamptz;
`;

/**
 * What each repository says about itself by the project standard: the passport, tasks, plans and
 * decisions under docs/. `docs_dirty` asks for a read at the next tick (a push to the default
 * branch sets it); `docs_tree_sha` is the tree last read, so an unchanged repository costs one call.
 */
const PROJECT_DOCS = `
alter table repos add column docs_tree_sha text;
alter table repos add column docs_dirty boolean not null default true;
alter table repos add column docs_synced_at timestamptz;

create table project_docs (
  repo text not null references repos (full_name) on delete cascade,
  path text not null,
  kind text not null check (kind in ('project', 'task', 'plan', 'decision')),
  doc_id text not null,
  title text,
  status text,
  fields jsonb not null default '{}'::jsonb,
  body text not null default '',
  blob_sha text not null,
  primary key (repo, path)
);
create index project_docs_kind on project_docs (kind, status)
`;

/** GitHub's id of a repository: it stays when the owner renames the repository. */
const REPO_GITHUB_ID = `
alter table repos add column github_id bigint;
create unique index repos_github_id on repos (github_id) where github_id is not null
`;

/** Metrics: one row per app, source, metric and day; collecting a day again replaces it. */
const METRICS = `
create table metric_days (
  app text not null,
  source text not null,
  metric text not null,
  day date not null,
  value numeric not null,
  unit text not null,
  primary key (app, source, metric, day)
);
create index metric_days_day on metric_days (day);
alter table metric_days enable row level security;
alter table settings add column metrics_trial_cost_limit numeric not null default 15;
alter table settings add column metrics_in_digest boolean not null default true;
alter table settings add column revenuecat_projects text not null default '{}'
`;

export const MIGRATIONS: Migration[] = [
  { name: '0001_schema', sql: SCHEMA },
  { name: '0002_seed_projects', sql: SEED_PROJECTS },
  { name: '0003_sessions_valid_after', sql: SESSIONS_VALID_AFTER },
  { name: '0004_project_docs', sql: PROJECT_DOCS },
  { name: '0005_repo_github_id', sql: REPO_GITHUB_ID },
  { name: '0006_metrics', sql: METRICS },
];

const TAG = '$wh_migration$';
const LOCK = 72031126;

/**
 * Applies the migrations that have not run yet and returns the names this call applied.
 *
 * Each migration runs as one DO block — a single statement, so it is atomic on any driver and any
 * pooler, with nothing left half-open on a pooled connection if it fails. Inside, an advisory lock
 * makes concurrent callers take turns, and whoever comes second sees the record and does nothing.
 * (A consequence: a migration is PL/pgSQL statements, so no bare \`select …;\` — use \`perform\`.)
 */
export async function migrate(sql: Sql, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  // Even "create table if not exists" races with itself across connections; take the lock first.
  await sql.exec(
    `do ${TAG}
     begin
       perform pg_advisory_xact_lock(${LOCK});
       create table if not exists schema_migrations (
         name text primary key, applied_at timestamptz not null default now(), applied_by text);
     end ${TAG};`,
  );
  const done = new Set((await sql.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const runId = randomUUID();
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    if (!/^[\w-]+$/.test(m.name) || m.sql.includes(TAG)) throw new Error(`bad migration: ${m.name}`);
    await sql.exec(
      `do ${TAG}
       begin
         perform pg_advisory_xact_lock(${LOCK});
         if exists (select 1 from schema_migrations where name = '${m.name}') then
           return;
         end if;
         ${m.sql.trim().replace(/;+$/, '')};
         insert into schema_migrations (name, applied_by) values ('${m.name}', '${runId}');
       end ${TAG};`,
    );
  }
  const mine = await sql.query<{ name: string }>('select name from schema_migrations where applied_by = $1 order by name', [runId]);
  return mine.map((r) => r.name);
}
