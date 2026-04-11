-- V3 Freeze Oleada 1: seed cleanup for 11111111-* scope only.
-- Safe operation script: auditable, transactional, FK-ordered deletes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.v3_repair_audit_log (
  audit_id bigint generated always as identity primary key,
  repair_batch_id text not null,
  operation text not null,
  table_name text not null,
  row_data jsonb not null,
  executed_at timestamptz not null default now(),
  executed_by text not null default current_user
);

CREATE TEMP TABLE _v3_seed_scope_oleada1 AS
SELECT '11111111-%'::text AS seed_prefix;

-- 1) v3_health_scores
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT hs.*
  FROM public.v3_health_scores hs
  CROSS JOIN _v3_seed_scope_oleada1 s
  WHERE hs.tenant_id::text LIKE s.seed_prefix OR hs.store_id::text LIKE s.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_health_scores', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_health_scores t
USING victims v
WHERE t.score_id = v.score_id;

-- 2) v3_clinical_signals
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT cs.*
  FROM public.v3_clinical_signals cs
  CROSS JOIN _v3_seed_scope_oleada1 s
  WHERE cs.tenant_id::text LIKE s.seed_prefix OR cs.store_id::text LIKE s.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_clinical_signals', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_clinical_signals t
USING victims v
WHERE t.signal_id = v.signal_id;

-- 3) v3_metrics_daily
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT md.*
  FROM public.v3_metrics_daily md
  CROSS JOIN _v3_seed_scope_oleada1 s
  WHERE md.tenant_id::text LIKE s.seed_prefix OR md.store_id::text LIKE s.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_metrics_daily', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_metrics_daily t
USING victims v
WHERE t.tenant_id = v.tenant_id
  AND t.store_id = v.store_id
  AND t.metric_date = v.metric_date;

-- 4) v3_scores_jobs
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT j.*
  FROM public.v3_scores_jobs j
  CROSS JOIN _v3_seed_scope_oleada1 s
  WHERE j.tenant_id::text LIKE s.seed_prefix OR j.store_id::text LIKE s.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_scores_jobs', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_scores_jobs t
USING victims v
WHERE t.job_id = v.job_id;

-- 5) v3_signals_jobs
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT j.*
  FROM public.v3_signals_jobs j
  CROSS JOIN _v3_seed_scope_oleada1 s
  WHERE j.tenant_id::text LIKE s.seed_prefix OR j.store_id::text LIKE s.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_signals_jobs', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_signals_jobs t
USING victims v
WHERE t.job_id = v.job_id;

-- 6) v3_metrics_jobs
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT j.*
  FROM public.v3_metrics_jobs j
  CROSS JOIN _v3_seed_scope_oleada1 s
  WHERE j.tenant_id::text LIKE s.seed_prefix OR j.store_id::text LIKE s.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_metrics_jobs', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_metrics_jobs t
USING victims v
WHERE t.job_id = v.job_id;

-- 7) v3_snapshot_jobs
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT j.*
  FROM public.v3_snapshot_jobs j
  CROSS JOIN _v3_seed_scope_oleada1 s
  WHERE j.tenant_id::text LIKE s.seed_prefix OR j.store_id::text LIKE s.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_snapshot_jobs', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_snapshot_jobs t
USING victims v
WHERE t.job_id = v.job_id;

-- 8) v3_snapshots
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT s.*
  FROM public.v3_snapshots s
  CROSS JOIN _v3_seed_scope_oleada1 k
  WHERE s.tenant_id::text LIKE k.seed_prefix OR s.store_id::text LIKE k.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_snapshots', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_snapshots t
USING victims v
WHERE t.snapshot_id = v.snapshot_id;

-- 9) v3_engine_runs
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT r.*
  FROM public.v3_engine_runs r
  CROSS JOIN _v3_seed_scope_oleada1 k
  WHERE r.tenant_id::text LIKE k.seed_prefix OR r.store_id::text LIKE k.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_engine_runs', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_engine_runs t
USING victims v
WHERE t.run_id = v.run_id;

-- 10) v3_domain_events
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT d.*
  FROM public.v3_domain_events d
  CROSS JOIN _v3_seed_scope_oleada1 k
  WHERE d.tenant_id::text LIKE k.seed_prefix OR d.store_id::text LIKE k.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_domain_events', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_domain_events t
USING victims v
WHERE t.domain_event_id = v.domain_event_id;

-- 11) v3_webhook_events
WITH batch AS (
  SELECT concat('v3_freeze_oleada1_', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"')) AS repair_batch_id
), victims AS (
  SELECT w.*
  FROM public.v3_webhook_events w
  CROSS JOIN _v3_seed_scope_oleada1 k
  WHERE w.tenant_id::text LIKE k.seed_prefix OR w.store_id::text LIKE k.seed_prefix
), audit AS (
  INSERT INTO public.v3_repair_audit_log (repair_batch_id, operation, table_name, row_data)
  SELECT b.repair_batch_id, 'delete_seed_oleada1', 'v3_webhook_events', to_jsonb(v.*)
  FROM victims v
  CROSS JOIN batch b
  RETURNING 1
)
DELETE FROM public.v3_webhook_events t
USING victims v
WHERE t.webhook_event_id = v.webhook_event_id;

DROP TABLE IF EXISTS _v3_seed_scope_oleada1;

COMMIT;
