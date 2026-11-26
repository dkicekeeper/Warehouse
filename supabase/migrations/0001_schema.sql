-- Warehouse dispatch board: state kept by the service.
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
