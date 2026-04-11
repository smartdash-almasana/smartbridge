-- SmartSeller V3 repair cleanup (auditable)
-- Run manually in production after backup and before re-enabling orchestrator.

begin;

create table if not exists public.v3_repair_audit_log (
  audit_id bigint generated always as identity primary key,
  repair_batch_id text not null,
  operation text not null,
  table_name text not null,
  row_data jsonb not null,
  executed_at timestamptz not null default now(),
  executed_by text not null default current_user
);

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
zombies as (
  select r.*
  from public.v3_engine_runs r
  where r.status = 'running'
    and r.metric_date in ('2026-03-11'::date, '2026-03-12'::date, '2026-03-13'::date)
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'close_zombie_run', 'v3_engine_runs', to_jsonb(z.*)
  from zombies z
  cross join batch b
  returning 1
)
update public.v3_engine_runs r
set status = 'failed',
    finished_at = now()
from zombies z
where r.run_id = z.run_id;

-- Seed scope:
--   - exact known UUID: 11111111-4444-4111-8111-111111111111
--   - prefix for second known seed family: 22222222-%
create temp table _v3_seed_scope as
select
  '11111111-4444-4111-8111-111111111111'::text as exact_seed,
  '22222222-%'::text as prefix_seed;

-- Requeue stale webhook processing leases before delete to avoid stuck claims.
with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
stale as (
  select w.*
  from public.v3_webhook_events w
  where w.processing_status = 'processing'
    and coalesce(w.processing_claimed_at, w.received_at) <= now() - interval '10 minutes'
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'requeue_stale_webhook', 'v3_webhook_events', to_jsonb(s.*)
  from stale s
  cross join batch b
  returning 1
)
update public.v3_webhook_events w
set processing_status = 'pending',
    processing_claimed_at = null,
    processing_error = null
from stale s
where w.webhook_event_id = s.webhook_event_id;

-- Requeue stale worker jobs by lease timeout.
with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
stale as (
  select j.* from public.v3_snapshot_jobs j
  where j.processing_status = 'processing'
    and coalesce(j.claimed_at, j.updated_at, j.created_at) <= now() - interval '10 minutes'
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'requeue_stale_job', 'v3_snapshot_jobs', to_jsonb(s.*)
  from stale s
  cross join batch b
  returning 1
)
update public.v3_snapshot_jobs j
set processing_status = 'pending',
    claimed_at = null,
    processing_error = null
from stale s
where j.job_id = s.job_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
stale as (
  select j.* from public.v3_metrics_jobs j
  where j.processing_status = 'processing'
    and coalesce(j.claimed_at, j.updated_at, j.created_at) <= now() - interval '10 minutes'
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'requeue_stale_job', 'v3_metrics_jobs', to_jsonb(s.*)
  from stale s
  cross join batch b
  returning 1
)
update public.v3_metrics_jobs j
set processing_status = 'pending',
    claimed_at = null,
    processing_error = null
from stale s
where j.job_id = s.job_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
stale as (
  select j.* from public.v3_signals_jobs j
  where j.processing_status = 'processing'
    and coalesce(j.claimed_at, j.updated_at, j.created_at) <= now() - interval '10 minutes'
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'requeue_stale_job', 'v3_signals_jobs', to_jsonb(s.*)
  from stale s
  cross join batch b
  returning 1
)
update public.v3_signals_jobs j
set processing_status = 'pending',
    claimed_at = null,
    processing_error = null
from stale s
where j.job_id = s.job_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
stale as (
  select j.* from public.v3_scores_jobs j
  where j.processing_status = 'processing'
    and coalesce(j.claimed_at, j.updated_at, j.created_at) <= now() - interval '10 minutes'
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'requeue_stale_job', 'v3_scores_jobs', to_jsonb(s.*)
  from stale s
  cross join batch b
  returning 1
)
update public.v3_scores_jobs j
set processing_status = 'pending',
    claimed_at = null,
    processing_error = null
from stale s
where j.job_id = s.job_id;

-- Purge seed/test contamination with audit trail.
-- Delete order respects FK dependencies.

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select cs.*
  from public.v3_clinical_signals cs
  cross join _v3_seed_scope s
  where cs.tenant_id::text = s.exact_seed or cs.tenant_id::text like s.prefix_seed
     or cs.store_id::text = s.exact_seed or cs.store_id::text like s.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_clinical_signals', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_clinical_signals t
using victims v
where t.signal_id = v.signal_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select hs.*
  from public.v3_health_scores hs
  cross join _v3_seed_scope s
  where hs.tenant_id::text = s.exact_seed or hs.tenant_id::text like s.prefix_seed
     or hs.store_id::text = s.exact_seed or hs.store_id::text like s.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_health_scores', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_health_scores t
using victims v
where t.score_id = v.score_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select md.*
  from public.v3_metrics_daily md
  cross join _v3_seed_scope s
  where md.tenant_id::text = s.exact_seed or md.tenant_id::text like s.prefix_seed
     or md.store_id::text = s.exact_seed or md.store_id::text like s.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_metrics_daily', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_metrics_daily t
using victims v
where t.tenant_id = v.tenant_id
  and t.store_id = v.store_id
  and t.metric_date = v.metric_date;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select j.*
  from public.v3_scores_jobs j
  cross join _v3_seed_scope s
  where j.tenant_id::text = s.exact_seed or j.tenant_id::text like s.prefix_seed
     or j.store_id::text = s.exact_seed or j.store_id::text like s.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_scores_jobs', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_scores_jobs t
using victims v
where t.job_id = v.job_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select j.*
  from public.v3_signals_jobs j
  cross join _v3_seed_scope s
  where j.tenant_id::text = s.exact_seed or j.tenant_id::text like s.prefix_seed
     or j.store_id::text = s.exact_seed or j.store_id::text like s.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_signals_jobs', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_signals_jobs t
using victims v
where t.job_id = v.job_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select j.*
  from public.v3_metrics_jobs j
  cross join _v3_seed_scope s
  where j.tenant_id::text = s.exact_seed or j.tenant_id::text like s.prefix_seed
     or j.store_id::text = s.exact_seed or j.store_id::text like s.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_metrics_jobs', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_metrics_jobs t
using victims v
where t.job_id = v.job_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select j.*
  from public.v3_snapshot_jobs j
  cross join _v3_seed_scope s
  where j.tenant_id::text = s.exact_seed or j.tenant_id::text like s.prefix_seed
     or j.store_id::text = s.exact_seed or j.store_id::text like s.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_snapshot_jobs', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_snapshot_jobs t
using victims v
where t.job_id = v.job_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select s.*
  from public.v3_snapshots s
  cross join _v3_seed_scope k
  where s.tenant_id::text = k.exact_seed or s.tenant_id::text like k.prefix_seed
     or s.store_id::text = k.exact_seed or s.store_id::text like k.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_snapshots', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_snapshots t
using victims v
where t.snapshot_id = v.snapshot_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select r.*
  from public.v3_engine_runs r
  cross join _v3_seed_scope k
  where r.tenant_id::text = k.exact_seed or r.tenant_id::text like k.prefix_seed
     or r.store_id::text = k.exact_seed or r.store_id::text like k.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_engine_runs', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_engine_runs t
using victims v
where t.run_id = v.run_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select d.*
  from public.v3_domain_events d
  cross join _v3_seed_scope k
  where d.tenant_id::text = k.exact_seed or d.tenant_id::text like k.prefix_seed
     or d.store_id::text = k.exact_seed or d.store_id::text like k.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_domain_events', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_domain_events t
using victims v
where t.domain_event_id = v.domain_event_id;

with batch as (
  select concat('v3_repair_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) as repair_batch_id
),
victims as (
  select w.*
  from public.v3_webhook_events w
  cross join _v3_seed_scope k
  where w.tenant_id::text = k.exact_seed or w.tenant_id::text like k.prefix_seed
     or w.store_id::text = k.exact_seed or w.store_id::text like k.prefix_seed
),
audit as (
  insert into public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  select b.repair_batch_id, 'delete_seed', 'v3_webhook_events', to_jsonb(v.*)
  from victims v
  cross join batch b
  returning 1
)
delete from public.v3_webhook_events t
using victims v
where t.webhook_event_id = v.webhook_event_id;

drop table if exists _v3_seed_scope;

commit;
