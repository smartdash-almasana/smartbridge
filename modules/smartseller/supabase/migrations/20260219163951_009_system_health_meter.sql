-- ============================================================
-- Migration 009: system health meter tables
-- ============================================================

-- -------------------------------------------------------
-- A) public.system_health_snapshots
-- -------------------------------------------------------
create table if not exists public.system_health_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  ts                    timestamptz not null default now(),
  engine_status         text        not null,
  pending_events        integer     not null default 0,
  oldest_event_seconds  integer     not null default 0,
  dead_letter_events    integer     not null default 0,
  active_workers        integer     not null default 0,
  stale_workers         integer     not null default 0,
  last_minute_claimed   integer     not null default 0,
  last_minute_processed integer     not null default 0,
  last_minute_failed    integer     not null default 0,
  raw                   jsonb       not null default '{}'::jsonb
);

create index if not exists ix_system_health_snapshots_ts
  on public.system_health_snapshots (ts desc);

alter table public.system_health_snapshots enable row level security;

revoke all on table public.system_health_snapshots from anon;
revoke all on table public.system_health_snapshots from authenticated;
revoke all on table public.system_health_snapshots from public;

-- -------------------------------------------------------
-- B) public.system_alerts
-- -------------------------------------------------------
create table if not exists public.system_alerts (
  alert_key     text        not null,
  fingerprint   text        not null,
  state         text        not null,
  severity      text        not null,
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,
  resolved_at   timestamptz null,
  evidence      jsonb       not null default '{}'::jsonb,
  constraint pk_system_alerts primary key (fingerprint)
);

create index if not exists ix_system_alerts_state
  on public.system_alerts (state, severity);

alter table public.system_alerts enable row level security;

revoke all on table public.system_alerts from anon;
revoke all on table public.system_alerts from authenticated;
revoke all on table public.system_alerts from public;

-- -------------------------------------------------------
-- C) public.system_notifications_outbox
-- -------------------------------------------------------
create table if not exists public.system_notifications_outbox (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  channel         text        not null,
  recipient       text        not null,
  subject         text        null,
  payload         jsonb       not null default '{}'::jsonb,
  status          text        not null default 'pending',
  attempts        integer     not null default 0,
  next_attempt_at timestamptz not null default now(),
  fingerprint     text        not null
);

create index if not exists ix_outbox_pending
  on public.system_notifications_outbox (status, next_attempt_at);

create unique index if not exists ix_outbox_fingerprint
  on public.system_notifications_outbox (fingerprint);

alter table public.system_notifications_outbox enable row level security;

revoke all on table public.system_notifications_outbox from anon;
revoke all on table public.system_notifications_outbox from authenticated;
revoke all on table public.system_notifications_outbox from public;;
