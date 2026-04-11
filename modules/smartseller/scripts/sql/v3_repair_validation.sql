-- V3 repair validation checklist queries

-- 1) Migraciones registradas
select version from supabase_migrations.schema_migrations
where version like '20260314_v3_%'
order by version;

-- 2) Tablas críticas existentes
select
  to_regclass('public.v3_snapshot_jobs')     as v3_snapshot_jobs,
  to_regclass('public.v3_metrics_jobs')      as v3_metrics_jobs,
  to_regclass('public.v3_signals_jobs')      as v3_signals_jobs,
  to_regclass('public.v3_scores_jobs')       as v3_scores_jobs,
  to_regclass('public.v3_worker_heartbeats') as v3_worker_heartbeats;

-- 3) RPCs críticas existentes
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and proname in (
    'v3_claim_webhook_events',
    'v3_enqueue_snapshot_jobs','v3_claim_snapshot_jobs',
    'v3_enqueue_metrics_jobs','v3_claim_metrics_jobs',
    'v3_enqueue_signals_jobs','v3_claim_signals_jobs',
    'v3_enqueue_scores_jobs','v3_claim_scores_jobs',
    'v3_set_updated_at'
  )
order by proname;

-- 4) Runs colgadas
select run_id, metric_date, status, started_at, finished_at
from public.v3_engine_runs
where status='running'
order by started_at asc;

-- 5) Seeds contaminantes
select 'v3_engine_runs' as t, count(*) from public.v3_engine_runs
where tenant_id::text = '11111111-4444-4111-8111-111111111111'
   or store_id::text  = '11111111-4444-4111-8111-111111111111'
   or tenant_id::text like '22222222-%'
   or store_id::text  like '22222222-%'
union all
select 'v3_health_scores', count(*) from public.v3_health_scores
where tenant_id::text = '11111111-4444-4111-8111-111111111111'
   or store_id::text  = '11111111-4444-4111-8111-111111111111'
   or tenant_id::text like '22222222-%'
   or store_id::text  like '22222222-%';

-- 6) Señal mínima clínica activa en historial reciente
select signal_key, severity, count(*) as rows
from public.v3_clinical_signals
where signal_key = 'no_orders_7d'
group by signal_key, severity
order by severity;

-- 7) Ingesta real ML en V3 (últimas 24h)
select count(*) as webhook_events_24h
from public.v3_webhook_events
where provider_key = 'mercadolibre'
  and received_at >= now() - interval '24 hours';

-- 8) Heartbeat de orchestrator
select worker_name, worker_instance, status, started_at, finished_at, last_seen_at
from public.v3_worker_heartbeats
where worker_name = 'v3-pipeline-orchestrator'
order by last_seen_at desc
limit 20;
