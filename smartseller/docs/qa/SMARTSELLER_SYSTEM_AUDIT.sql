-- =============================================================================
-- SMARTSELLER_SYSTEM_AUDIT.sql
-- =============================================================================
-- Repo   : E:\BuenosPasos\smartseller-v2
-- DB     : bewjtoozxukypjbckcyt.supabase.co
-- Author : Antigravity (Principal Technical Auditor)
-- Date   : 2026-03-08
--
-- Purpose:
--   SELECT-only clinical pipeline audit.
--   Returns a unified diagnostic table:
--     component | status | evidence | detail
--
-- Status values: OK | PARTIAL | MISSING | STALLED | DEAD | UNKNOWN
--
-- Pipeline canónico V2:
--   v2_webhook_events
--     → v2_domain_events
--       → v2_snapshots
--         → v2_metrics_daily
--           → v2_clinical_signals
--             → v2_health_scores
--
-- Usage: Run as-is in Supabase SQL Editor (no params, no writes).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SECTION 1: Layer existence (structural)
-- -----------------------------------------------------------------------------
WITH layer_exists AS (
  SELECT
    'v2_webhook_events'         AS layer, 'webhooks'      AS alias,
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='v2_webhook_events') AS exists
  UNION ALL SELECT 'v2_domain_events',    'domain_events',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='v2_domain_events')
  UNION ALL SELECT 'v2_snapshots',        'snapshots',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='v2_snapshots')
  UNION ALL SELECT 'v2_metrics_daily',    'metrics',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='v2_metrics_daily')
  UNION ALL SELECT 'v2_clinical_signals', 'clinical_signals',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='v2_clinical_signals')
  UNION ALL SELECT 'v2_health_scores',    'health_score',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='v2_health_scores')
),

-- -----------------------------------------------------------------------------
-- SECTION 2: Multi-tenant safety check per layer
-- -----------------------------------------------------------------------------
tenant_safety AS (
  SELECT
    'v2_webhook_events' AS tbl,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_webhook_events' AND column_name='tenant_id') AS has_tenant,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_webhook_events' AND column_name='store_id')  AS has_store
  UNION ALL SELECT 'v2_domain_events',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_domain_events' AND column_name='tenant_id'),
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_domain_events' AND column_name='store_id')
  UNION ALL SELECT 'v2_snapshots',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_snapshots' AND column_name='tenant_id'),
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_snapshots' AND column_name='store_id')
  UNION ALL SELECT 'v2_metrics_daily',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_metrics_daily' AND column_name='tenant_id'),
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_metrics_daily' AND column_name='store_id')
  UNION ALL SELECT 'v2_clinical_signals',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_clinical_signals' AND column_name='tenant_id'),
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_clinical_signals' AND column_name='store_id')
  UNION ALL SELECT 'v2_health_scores',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_health_scores' AND column_name='tenant_id'),
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name='v2_health_scores' AND column_name='store_id')
),

-- -----------------------------------------------------------------------------
-- SECTION 3: Data vitality (rows + last_update + freshness)
-- -----------------------------------------------------------------------------
vitality AS (
  SELECT 'webhooks'         AS component, 'v2_webhook_events'   AS real_table,
    (SELECT count(*)         FROM v2_webhook_events)   AS row_count,
    (SELECT max(received_at) FROM v2_webhook_events)   AS last_ts
  UNION ALL
  SELECT 'domain_events',      'v2_domain_events',
    (SELECT count(*)           FROM v2_domain_events),
    (SELECT max(normalized_at) FROM v2_domain_events)
  UNION ALL
  SELECT 'snapshots',          'v2_snapshots',
    (SELECT count(*)           FROM v2_snapshots),
    (SELECT max(snapshot_at)   FROM v2_snapshots)
  UNION ALL
  SELECT 'metrics',            'v2_metrics_daily',
    (SELECT count(*)           FROM v2_metrics_daily),
    -- metric_date is a date; cast to timestamptz for comparison
    (SELECT max(metric_date)::timestamptz FROM v2_metrics_daily)
  UNION ALL
  SELECT 'clinical_signals',   'v2_clinical_signals',
    (SELECT count(*)           FROM v2_clinical_signals),
    (SELECT max(created_at)    FROM v2_clinical_signals)
  UNION ALL
  SELECT 'health_score',       'v2_health_scores',
    (SELECT count(*)           FROM v2_health_scores),
    (SELECT max(computed_at)   FROM v2_health_scores)
),

-- Attach freshness label to each layer
vitality_freshness AS (
  SELECT *,
    CASE
      WHEN last_ts IS NULL                           THEN 'EMPTY'
      WHEN last_ts > now() - interval '24 hours'     THEN 'HOT'
      WHEN last_ts > now() - interval '7 days'       THEN 'WARM'
      ELSE                                                'COLD'
    END AS freshness
  FROM vitality
),

-- -----------------------------------------------------------------------------
-- SECTION 4: Pipeline stall detection
-- -----------------------------------------------------------------------------
stall AS (
  SELECT
    -- How many webhooks have NO matching domain_event
    (SELECT count(*)
       FROM v2_webhook_events we
       WHERE NOT EXISTS (
         SELECT 1 FROM v2_domain_events de
         WHERE de.source_event_id = we.event_id
       )
    )::int AS wh_unprocessed,

    -- Ingest job states
    (SELECT count(*) FROM v2_webhook_ingest_jobs WHERE status = 'pending')     AS jobs_pending,
    (SELECT count(*) FROM v2_webhook_ingest_jobs WHERE status = 'failed')      AS jobs_failed,
    (SELECT count(*) FROM v2_webhook_ingest_jobs WHERE status = 'dead_letter') AS jobs_dlq,
    (SELECT count(*) FROM v2_webhook_ingest_jobs WHERE status = 'done')        AS jobs_done,

    -- DLQ
    (SELECT count(*) FROM v2_dlq_events WHERE status = 'open')   AS dlq_open,
    (SELECT count(*) FROM v2_dlq_events)                          AS dlq_total,

    -- Cron activity (validates background scheduler is running)
    (SELECT count(*) FROM v2_cron_runs
       WHERE status = 'ok' AND created_at > now() - interval '24 hours') AS cron_ok_24h,
    (SELECT max(created_at) FROM v2_cron_runs)                            AS cron_last_run
),

-- -----------------------------------------------------------------------------
-- SECTION 5: Worker heartbeat status
-- -----------------------------------------------------------------------------
worker_status AS (
  SELECT
    worker_name,
    max(last_seen_at)                 AS last_heartbeat,
    now() - max(last_seen_at)         AS heartbeat_age,
    count(*)                          AS instance_count,
    CASE
      WHEN max(last_seen_at) > now() - interval '15 minutes' THEN 'ALIVE'
      WHEN max(last_seen_at) > now() - interval '1 hour'     THEN 'STALE'
      WHEN max(last_seen_at) IS NOT NULL                      THEN 'DEAD'
      ELSE                                                         'MISSING'
    END AS status
  FROM v2_worker_heartbeats
  GROUP BY worker_name
),

-- Runtime metrics table (v2_runtime_metrics_minute)
runtime_activity AS (
  SELECT
    count(*)                              AS runtime_rows,
    max(bucket_minute)                    AS runtime_last
  FROM v2_runtime_metrics_minute
),

-- -----------------------------------------------------------------------------
-- SECTION 6: Traceability (score → signal → run — can we walk the chain?)
-- -----------------------------------------------------------------------------
trace_check AS (
  SELECT
    count(*) FILTER (
      WHERE cs.signal_id IS NOT NULL
    ) AS scores_with_signals,
    count(*) FILTER (
      WHERE er.run_id IS NOT NULL
    ) AS scores_with_run,
    count(*) FILTER (
      WHERE er.status = 'done'
    ) AS scores_with_done_run
  FROM v2_health_scores hs
  LEFT JOIN v2_engine_runs er  ON er.run_id = hs.run_id
  LEFT JOIN v2_clinical_signals cs ON cs.run_id = hs.run_id
),

-- -----------------------------------------------------------------------------
-- SECTION 7: Pipeline layer status (OK / STALLED / PARTIAL / MISSING)
-- -----------------------------------------------------------------------------
pipeline_status AS (
  SELECT
    v.component,
    v.real_table,
    v.row_count,
    v.last_ts,
    v.freshness,
    ts.has_tenant,
    ts.has_store,
    CASE
      -- Layer is empty
      WHEN v.row_count = 0 AND v.component = 'webhooks'        THEN 'MISSING'
      WHEN v.row_count = 0 AND v.component = 'domain_events'   THEN
        CASE WHEN (SELECT row_count FROM vitality WHERE component='webhooks') > 0
             THEN 'STALLED' ELSE 'MISSING' END
      WHEN v.row_count = 0 AND v.component = 'snapshots'       THEN
        CASE WHEN (SELECT row_count FROM vitality WHERE component='domain_events') > 0
             THEN 'STALLED' ELSE 'MISSING' END
      WHEN v.row_count = 0 AND v.component = 'metrics'         THEN
        CASE WHEN (SELECT row_count FROM vitality WHERE component='snapshots') > 0
             THEN 'STALLED' ELSE 'MISSING' END
      WHEN v.row_count = 0 AND v.component = 'clinical_signals' THEN
        CASE WHEN (SELECT row_count FROM vitality WHERE component='metrics') > 0
             THEN 'STALLED' ELSE 'MISSING' END
      WHEN v.row_count = 0 AND v.component = 'health_score'    THEN
        CASE WHEN (SELECT row_count FROM vitality WHERE component='clinical_signals') > 0
             THEN 'STALLED' ELSE 'MISSING' END
      -- Layer has data but is cold (>7d)
      WHEN v.freshness = 'COLD'  THEN 'PARTIAL'
      -- Layer has data and is warm or hot
      WHEN v.freshness IN ('HOT','WARM') THEN 'OK'
      -- Fallback
      ELSE 'UNKNOWN'
    END AS status
  FROM vitality_freshness v
  LEFT JOIN tenant_safety ts ON ts.tbl = v.real_table
),

-- -----------------------------------------------------------------------------
-- SECTION 8: Phase calculation
-- highest_achieved_phase = highest layer with row_count > 0
-- current_operational_phase = highest layer that is HOT or WARM
-- -----------------------------------------------------------------------------
phase_calc AS (
  SELECT
    'F' || (
      CASE
        WHEN (SELECT row_count FROM vitality WHERE component='health_score')      > 0 THEN '5'
        WHEN (SELECT row_count FROM vitality WHERE component='clinical_signals')  > 0 THEN '4'
        WHEN (SELECT row_count FROM vitality WHERE component='metrics')           > 0 THEN '3'
        WHEN (SELECT row_count FROM vitality WHERE component='snapshots')         > 0 THEN '2'
        WHEN (SELECT row_count FROM vitality WHERE component='domain_events')     > 0 THEN '1'
        WHEN (SELECT row_count FROM vitality WHERE component='webhooks')          > 0 THEN '0'
        ELSE 'UNKNOWN'
      END
    ) AS highest_achieved_phase,

    -- Operational phase: highest layer that still has HOT or WARM data
    'F' || (
      CASE
        WHEN (SELECT freshness FROM vitality_freshness WHERE component='health_score')      IN ('HOT','WARM') THEN '5'
        WHEN (SELECT freshness FROM vitality_freshness WHERE component='clinical_signals')  IN ('HOT','WARM') THEN '4'
        WHEN (SELECT freshness FROM vitality_freshness WHERE component='metrics')           IN ('HOT','WARM') THEN '3'
        WHEN (SELECT freshness FROM vitality_freshness WHERE component='snapshots')         IN ('HOT','WARM') THEN '2'
        WHEN (SELECT freshness FROM vitality_freshness WHERE component='domain_events')     IN ('HOT','WARM') THEN '1'
        WHEN (SELECT freshness FROM vitality_freshness WHERE component='webhooks')          IN ('HOT','WARM') THEN '0'
        ELSE 'UNKNOWN'
      END
    ) AS current_operational_phase,

    -- Operational status
    CASE
      WHEN (SELECT status FROM worker_status LIMIT 1) = 'ALIVE' THEN 'LIVE'
      WHEN (SELECT status FROM worker_status LIMIT 1) = 'DEAD'  THEN 'STALLED'
      ELSE 'UNKNOWN'
    END AS current_operational_status
),

-- Primary blocker
blocker AS (
  SELECT
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM v2_worker_heartbeats WHERE last_seen_at > now()-interval '15 minutes')
           THEN 'worker_runtime_dead'
      WHEN (SELECT wh_unprocessed FROM stall) > 0 AND (SELECT jobs_failed FROM stall) > 0
           THEN 'ingest_jobs_failed'
      WHEN (SELECT dlq_open FROM stall) > 0
           THEN 'dlq_events_open'
      ELSE 'none'
    END AS primary_blocker
)

-- =============================================================================
-- FINAL REPORT: component | status | evidence | detail
-- =============================================================================

-- A. Pipeline layers
SELECT
  ps.component,
  ps.status,
  'rows=' || ps.row_count || ' freshness=' || ps.freshness AS evidence,
  'table=' || ps.real_table
    || ' last_update=' || COALESCE(ps.last_ts::text, 'NULL')
    || ' tenant_safe=' || CASE WHEN ps.has_tenant AND ps.has_store THEN 'YES' ELSE 'WARN' END
  AS detail
FROM pipeline_status ps

UNION ALL

-- B. Worker / Runtime status
SELECT
  'worker:' || ws.worker_name,
  ws.status,
  'instances=' || ws.instance_count || ' last_seen=' || ws.last_heartbeat::text,
  'heartbeat_age=' || COALESCE(ws.heartbeat_age::text, 'never')
    || ' (ALIVE=<15m | STALE=<1h | DEAD=>1h)'
FROM worker_status ws

UNION ALL

-- C. Runtime metrics row (v2_runtime_metrics_minute)
SELECT
  'runtime_metrics',
  CASE
    WHEN ra.runtime_rows = 0 THEN 'MISSING'
    WHEN ra.runtime_last > now() - interval '1 hour' THEN 'OK'
    ELSE 'STALE'
  END,
  'rows=' || ra.runtime_rows,
  'last_bucket=' || COALESCE(ra.runtime_last::text, 'never')
FROM runtime_activity ra

UNION ALL

-- D. Cron / Scheduler health
SELECT
  'scheduler_cron',
  CASE
    WHEN (SELECT cron_ok_24h FROM stall) > 0 THEN 'OK'
    ELSE 'DEAD'
  END,
  'ok_runs_last_24h=' || (SELECT cron_ok_24h FROM stall)::text,
  'last_run=' || COALESCE((SELECT cron_last_run FROM stall)::text, 'never')

UNION ALL

-- E. Ingest pipeline stall (unprocessed webhooks)
SELECT
  'ingest_backlog',
  CASE
    WHEN (SELECT wh_unprocessed FROM stall) = 0 THEN 'OK'
    WHEN (SELECT jobs_failed    FROM stall) > 0  THEN 'STALLED'
    ELSE 'PARTIAL'
  END,
  'unprocessed_webhooks=' || (SELECT wh_unprocessed FROM stall)::text
    || ' jobs_failed='    || (SELECT jobs_failed     FROM stall)::text
    || ' jobs_dlq='       || (SELECT jobs_dlq        FROM stall)::text,
  'dlq_open=' || (SELECT dlq_open FROM stall)::text
    || ' dlq_total='      || (SELECT dlq_total FROM stall)::text

UNION ALL

-- F. Traceability: score->signal->run chain
SELECT
  'traceability_score_to_run',
  CASE
    WHEN (SELECT scores_with_done_run FROM trace_check) > 0 THEN 'OK'
    WHEN (SELECT scores_with_run      FROM trace_check) > 0 THEN 'PARTIAL'
    ELSE 'MISSING'
  END,
  'scores_with_signals=' || (SELECT scores_with_signals   FROM trace_check)::text
    || ' scores_with_done_run=' || (SELECT scores_with_done_run FROM trace_check)::text,
  'Trace: v2_health_scores → v2_engine_runs → v2_clinical_signals'

UNION ALL

-- G. Phase & Operational Status
SELECT 'highest_achieved_phase',    pc.highest_achieved_phase,    'F5=health_score F4=signals F3=metrics F2=snapshots F1=domain F0=webhooks', 'Highest layer with row_count > 0' FROM phase_calc pc
UNION ALL
SELECT 'current_operational_phase', pc.current_operational_phase, 'HOT(<24h) or WARM(<7d) required', 'Highest layer with fresh data'    FROM phase_calc pc
UNION ALL
SELECT 'current_operational_status', pc.current_operational_status, 'LIVE=worker alive STALLED=worker dead', 'Worker-driven operational state' FROM phase_calc pc

UNION ALL

-- H. Primary blocker
SELECT 'primary_blocker', b.primary_blocker, 'First actionable blocker detected', 'Fix this to advance operational phase' FROM blocker b

ORDER BY
  CASE component
    WHEN 'webhooks'                   THEN 1
    WHEN 'domain_events'              THEN 2
    WHEN 'snapshots'                  THEN 3
    WHEN 'metrics'                    THEN 4
    WHEN 'clinical_signals'           THEN 5
    WHEN 'health_score'               THEN 6
    WHEN 'ingest_backlog'             THEN 7
    WHEN 'scheduler_cron'             THEN 8
    WHEN 'runtime_metrics'            THEN 9
    ELSE                                   10
  END,
  component;

-- =============================================================================
-- END OF AUDIT SCRIPT
-- =============================================================================
