-- ─────────────────────────────────────────────────────────────────────────────
-- QA Automation: ML Reconciliation Worker
-- Archivo: docs/qa/QA_AUTOMATION_RECONCILIATION.sql
-- Ejecutar como SELECT-only contra prod Supabase.
-- Devuelve PASS/FAIL por cada invariant.
--
-- Ventanas explícitas:
--   BACKLOG_GRACE    = 15 min  (acceptable lag sobre cron schedule)
--   STUCK_RUNNING    = 10 min  (running sin actualización => worker colgado)
--   DLQ_THRESHOLD    = 10 intentos
--   METRICS_WINDOW   = 5 min
--   HEARTBEAT_WINDOW = 15 min
-- ─────────────────────────────────────────────────────────────────────────────

WITH
  -- 1) Backlog viejo: jobs pending/failed con next_eligible_at ya vencido >15 min
  backlog_old AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_reconciliation_jobs
    WHERE status IN ('pending', 'failed')
      AND next_eligible_at <= now() - interval '15 minutes'
  ),

  -- 2) Running stuck: jobs en 'running' con locked_at >10 min (worker colgado)
  running_stuck AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_reconciliation_jobs
    WHERE status = 'running'
      AND locked_at <= now() - interval '10 minutes'
  ),

  -- 3) DLQ invariant: attempts>=10 que NO son dead_letter
  dlq_invariant_violations AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_reconciliation_jobs
    WHERE attempts >= 10
      AND status != 'dead_letter'
  ),

  -- 4a) Métricas recientes (5 min)
  metrics_recent AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_runtime_metrics_minute
    WHERE worker_name = 'meli-reconcile'
      AND bucket_minute >= now() - interval '5 minutes'
  ),

  -- 4b) Heartbeat reciente (15 min)
  heartbeat_recent AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_worker_heartbeats
    WHERE worker_name = 'meli-reconcile'
      AND last_seen_at >= now() - interval '15 minutes'
  )

SELECT '1.backlog_old_jobs' AS "check",
  CASE WHEN b.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('pending_failed_gt15m=' || b.n)::text AS detail
FROM backlog_old b

UNION ALL

SELECT '2.running_stuck' AS "check",
  CASE WHEN r.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('running_locked_gt10m=' || r.n)::text AS detail
FROM running_stuck r

UNION ALL

SELECT '3.dlq_invariant' AS "check",
  CASE WHEN d.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('attempts_ge10_not_dlq=' || d.n)::text AS detail
FROM dlq_invariant_violations d

UNION ALL

SELECT '4a.metrics_recent_5m' AS "check",
  CASE WHEN m.n >= 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('metric_rows_last_5m=' || m.n)::text AS detail
FROM metrics_recent m

UNION ALL

SELECT '4b.heartbeat_recent_15m' AS "check",
  CASE WHEN h.n >= 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('heartbeat_instances_last_15m=' || h.n)::text AS detail
FROM heartbeat_recent h

ORDER BY "check";
