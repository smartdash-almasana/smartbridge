-- ─────────────────────────────────────────────────────────────────────────────
-- QA Automation: Systemic Cross-Domain Invariants (SmartSeller V2)
-- Archivo: docs/qa/QA_AUTOMATION_SYSTEM.sql
-- Ejecutar como SELECT-only contra prod Supabase.
-- Devuelve PASS/FAIL/SKIP por cada invariant.
--
-- Ventanas explícitas:
--   FRESHNESS_WINDOW = 24 horas (score/snapshots/reconciliation)
--   DRIFT_GRACE      = 5 min (tolerancia temporal para eventos futuros)
--   HEARTBEAT_WINDOW = 15 min (monitoreo de workers)
--   METRICS_WINDOW   = 5 min (monitoreo de latencia/throughput)
-- ─────────────────────────────────────────────────────────────────────────────

WITH
  -- 1) Orphan domain events (store_id o tenant_id = NULL)
  orphan_domain_events AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_domain_events
    WHERE store_id IS NULL OR tenant_id IS NULL
  ),

  -- 2) Duplicate source_event_id (Idempotencia V2)
  duplicate_source_event_id AS (
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT source_event_id
      FROM public.v2_domain_events
      WHERE source_event_id IS NOT NULL
      GROUP BY source_event_id
      HAVING COUNT(*) > 1
    ) dup
  ),

  -- 3) Reconcile Freshness: stores activos (ML) deben tener order.reconciled <= 24h
  reconcile_freshness AS (
    SELECT COUNT(*)::int AS missing_stores
    FROM public.v2_stores s
    JOIN public.v2_oauth_tokens t ON s.store_id = t.store_id AND t.status = 'active'
    WHERE s.provider_key = 'mercadolibre'
      AND NOT EXISTS (
        SELECT 1
        FROM public.v2_domain_events e
        WHERE e.store_id = s.store_id
          AND e.event_type = 'order.reconciled'
          AND e.occurred_at >= now() - interval '24 hours'
      )
  ),

  -- 4) Snapshot Freshness: todo store debe tener un snapshot reciente <= 24h
  snapshot_freshness AS (
    SELECT COUNT(*)::int AS missing_stores
    FROM public.v2_stores s
    JOIN public.v2_oauth_tokens t ON s.store_id = t.store_id AND t.status = 'active'
    WHERE s.provider_key = 'mercadolibre'
      AND NOT EXISTS (
        SELECT 1
        FROM public.v2_snapshots snap
        WHERE snap.store_id = s.store_id
          AND snap.snapshot_at >= now() - interval '24 hours'
      )
  ),

  -- 8) Timezone Drift Guard: timestamps no pueden estar en el futuro por > 5m
  timezone_drift_guard AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_domain_events
    WHERE occurred_at > now() + interval '5 minutes'
  ),

  -- 9) Worker Health: heartbeats recientes para los 3 workers (<= 15m)
  worker_health AS (
    SELECT 
      (SELECT COUNT(*)::int FROM public.v2_worker_heartbeats WHERE worker_name = 'ingest-webhook-to-domain' AND last_seen_at >= now() - interval '15 minutes') AS ingest_ok,
      (SELECT COUNT(*)::int FROM public.v2_worker_heartbeats WHERE worker_name = 'token-refresh' AND last_seen_at >= now() - interval '15 minutes') AS token_ok,
      (SELECT COUNT(*)::int FROM public.v2_worker_heartbeats WHERE worker_name = 'meli-reconcile' AND last_seen_at >= now() - interval '15 minutes') AS reconcile_ok
  ),

  -- 10) Metrics Health: filas de runtime_metrics para los 3 workers en ult 5m
  metrics_health AS (
    SELECT 
      (SELECT COUNT(*)::int FROM public.v2_runtime_metrics_minute WHERE worker_name = 'ingest-webhook-to-domain' AND bucket_minute >= now() - interval '5 minutes') AS ingest_ok,
      (SELECT COUNT(*)::int FROM public.v2_runtime_metrics_minute WHERE worker_name = 'token-refresh' AND bucket_minute >= now() - interval '5 minutes') AS token_ok,
      (SELECT COUNT(*)::int FROM public.v2_runtime_metrics_minute WHERE worker_name = 'meli-reconcile' AND bucket_minute >= now() - interval '5 minutes') AS reconcile_ok
  )

-- ================= Resultados ================= --

SELECT '1.system.orphan_domain_events' AS "check",
  CASE WHEN (SELECT n FROM orphan_domain_events) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  'orphan_count=' || (SELECT n FROM orphan_domain_events) AS detail

UNION ALL

SELECT '2.system.duplicate_source_event_id' AS "check",
  CASE WHEN (SELECT n FROM duplicate_source_event_id) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  'duplicates=' || (SELECT n FROM duplicate_source_event_id) AS detail

UNION ALL

SELECT '3.system.reconcile_freshness' AS "check",
  CASE WHEN (SELECT missing_stores FROM reconcile_freshness) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  'active_stores_missing_reconciliation=' || (SELECT missing_stores FROM reconcile_freshness) AS detail

UNION ALL

SELECT '4.system.snapshot_freshness' AS "check",
  CASE WHEN (SELECT missing_stores FROM snapshot_freshness) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  'stores_missing_recent_snapshot=' || (SELECT missing_stores FROM snapshot_freshness) AS detail

UNION ALL

-- 5) Order & Payment consistency (Normalización financiera V0) -> V2 no las tiene
SELECT '5.system.order_payment_consistency' AS "check",
  'SKIP' AS status,
  'SKIP (table missing: orders/payments)' AS detail

UNION ALL

-- 6) Fulfillment Orders consistency -> V2 no tiene tabla separada (Shopify future)
SELECT '6.system.fulfillment_consistency' AS "check",
  'SKIP' AS status,
  'SKIP (table missing: fulfillments)' AS detail

UNION ALL

-- 7) Currency Integrity -> V2 usa fields en payload (no tablas columnarias explícitas yet)
SELECT '7.system.currency_integrity' AS "check",
  'SKIP' AS status,
  'SKIP (table missing: isolated financial tables)' AS detail

UNION ALL

SELECT '8.system.timezone_drift_guard' AS "check",
  CASE WHEN (SELECT n FROM timezone_drift_guard) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  'future_occurred_at_events=' || (SELECT n FROM timezone_drift_guard) AS detail

UNION ALL

SELECT '9.system.worker_health' AS "check",
  CASE WHEN (SELECT ingest_ok * token_ok * reconcile_ok FROM worker_health) > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  (SELECT 'ingest='||ingest_ok||', token='||token_ok||', reconcile='||reconcile_ok FROM worker_health) AS detail

UNION ALL

SELECT '10.system.metrics_health' AS "check",
  CASE WHEN (SELECT ingest_ok * token_ok * reconcile_ok FROM metrics_health) > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  (SELECT 'ingest='||ingest_ok||', token='||token_ok||', reconcile='||reconcile_ok FROM metrics_health) AS detail

ORDER BY "check";
