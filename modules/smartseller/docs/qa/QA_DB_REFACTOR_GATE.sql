-- ─────────────────────────────────────────────────────────────────────────────
-- QA Gate: DB Refactor Phase 0
-- Archivo: docs/qa/QA_DB_REFACTOR_GATE.sql
-- SELECT-only. Devuelve PASS / FAIL / SKIP por invariant crítico.
-- Cada check incluye la query que lo sustenta y un detail explicativo.
-- Ejecutar contra Supabase (schema public).
-- ─────────────────────────────────────────────────────────────────────────────

WITH

  -- ── IDENTIDAD ──────────────────────────────────────────────────────────────

  -- [B1/B2] v2_domain_events: tenant_id y store_id permiten NULL
  de_nullable_identity AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_domain_events
    WHERE store_id IS NULL OR tenant_id IS NULL
  ),

  -- [B3] v2_domain_events: occurred_at permite NULL
  de_nullable_occurred_at AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_domain_events
    WHERE occurred_at IS NULL
  ),

  -- [B4/B5] v2_snapshots: store_id y tenant_id permiten NULL
  snap_nullable_identity AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_snapshots
    WHERE store_id IS NULL OR tenant_id IS NULL
  ),

  -- [B4-extra] v2_snapshots: snapshot_at permite NULL
  snap_nullable_at AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_snapshots
    WHERE snapshot_at IS NULL
  ),

  -- ── IDEMPOTENCIA ────────────────────────────────────────────────────────────

  -- [I1] UNIQUE source_event_id en v2_domain_events
  de_idempotency_index AS (
    SELECT COUNT(*)::int AS n
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'v2_domain_events'
      AND indexdef ILIKE '%unique%'
      AND indexdef ILIKE '%source_event_id%'
  ),

  -- [I2] UNIQUE dedupe key en v2_webhook_events
  we_dedupe_index AS (
    SELECT COUNT(*)::int AS n
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'v2_webhook_events'
      AND indexdef ILIKE '%unique%'
      AND indexdef ILIKE '%provider_event_id%'
  ),

  -- [I3] Duplicados reales en v2_domain_events (nunca debería ser > 0)
  de_actual_duplicates AS (
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT source_event_id
      FROM public.v2_domain_events
      WHERE source_event_id IS NOT NULL
      GROUP BY source_event_id
      HAVING COUNT(*) > 1
    ) dup
  ),

  -- ── DETERMINISMO / TIE-BREAKER ──────────────────────────────────────────────

  -- [D1] normalized_at NOT NULL en v2_domain_events (tie-breaker disponible)
  de_normalized_at_not_null AS (
    SELECT COUNT(*)::int AS n
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v2_domain_events'
      AND column_name = 'normalized_at'
      AND is_nullable = 'NO'
  ),

  -- ── FK CROSS-TENANT ─────────────────────────────────────────────────────────

  -- [FK1] v2_domain_events.source_event_id → v2_webhook_events.event_id
  -- (garantía: domain_events solo existen para webhook_events con store_id FK válido)
  de_source_fk AS (
    SELECT COUNT(*)::int AS n
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON rc.constraint_name = kcu.constraint_name
    WHERE kcu.table_name = 'v2_domain_events'
      AND kcu.column_name = 'source_event_id'
  ),

  -- [FK2] v2_snapshots.store_id → v2_stores.store_id (ausente según auditoría)
  snap_store_fk AS (
    SELECT COUNT(*)::int AS n
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON rc.constraint_name = kcu.constraint_name
    WHERE kcu.table_name = 'v2_snapshots'
      AND kcu.column_name = 'store_id'
  ),

  -- ── TRIGGERS updated_at ─────────────────────────────────────────────────────

  -- [T1] Triggers updated_at en tablas V2 con updated_at
  v2_updated_at_triggers AS (
    SELECT COUNT(*)::int AS n
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table IN ('v2_stores','v2_domain_events','v2_snapshots','v2_sellers','v2_tenants')
      AND trigger_name ILIKE '%updated_at%'
  ),

  -- ── REPO vs DB DRIFT ────────────────────────────────────────────────────────

  -- [DR1] Tablas core sin DDL en repo (verificado manualmente — marcadas aquí como control)
  -- Chequeamos si existen en DB (deben existir); si no existen la situación es diferente
  missing_core_tables AS (
    SELECT COUNT(*)::int AS missing
    FROM (
      SELECT unnest(ARRAY['v2_tenants','v2_sellers','v2_stores','v2_domain_events','v2_snapshots','v2_metrics_daily']) AS tname
    ) expected
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = expected.tname
    )
  ),

  -- [DR2] Tablas core tipadas del contrato V1 que NO existen en DB
  missing_v1_entities AS (
    SELECT COUNT(*)::int AS missing
    FROM (
      SELECT unnest(ARRAY['v2_orders','v2_order_items','v2_payments','v2_refunds','v2_fulfillments']) AS tname
    ) expected
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name = expected.tname
    )
  )

-- ═══════════════════════════════ OUTPUT ════════════════════════════════════

SELECT '1.B1B2.de_null_identity'          AS "check",
  CASE WHEN (SELECT n FROM de_nullable_identity) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  'orphan_rows='    || (SELECT n FROM de_nullable_identity)  AS detail

UNION ALL SELECT '2.B3.de_null_occurred_at',
  CASE WHEN (SELECT n FROM de_nullable_occurred_at) = 0 THEN 'PASS' ELSE 'FAIL' END,
  'null_occurred_at=' || (SELECT n FROM de_nullable_occurred_at)

UNION ALL SELECT '3.B4B5.snap_null_identity',
  CASE WHEN (SELECT n FROM snap_nullable_identity) = 0 THEN 'PASS' ELSE 'FAIL' END,
  'orphan_rows='    || (SELECT n FROM snap_nullable_identity)

UNION ALL SELECT '4.B4x.snap_null_snapshot_at',
  CASE WHEN (SELECT n FROM snap_nullable_at) = 0 THEN 'PASS' ELSE 'FAIL' END,
  'null_snapshot_at=' || (SELECT n FROM snap_nullable_at)

UNION ALL SELECT '5.I1.de_unique_source_event_id',
  CASE WHEN (SELECT n FROM de_idempotency_index) >= 1 THEN 'PASS' ELSE 'FAIL' END,
  'unique_indexes_found=' || (SELECT n FROM de_idempotency_index)

UNION ALL SELECT '6.I2.we_unique_dedupe',
  CASE WHEN (SELECT n FROM we_dedupe_index) >= 1 THEN 'PASS' ELSE 'FAIL' END,
  'unique_indexes_found=' || (SELECT n FROM we_dedupe_index)

UNION ALL SELECT '7.I3.de_actual_duplicates',
  CASE WHEN (SELECT n FROM de_actual_duplicates) = 0 THEN 'PASS' ELSE 'FAIL' END,
  'duplicate_source_event_ids=' || (SELECT n FROM de_actual_duplicates)

UNION ALL SELECT '8.D1.de_tiebreaker_normalized_at',
  CASE WHEN (SELECT n FROM de_normalized_at_not_null) >= 1 THEN 'PASS' ELSE 'FAIL' END,
  'normalized_at_not_null_cols=' || (SELECT n FROM de_normalized_at_not_null)

UNION ALL SELECT '9.FK1.de_source_fk_to_webhook_events',
  CASE WHEN (SELECT n FROM de_source_fk) >= 1 THEN 'PASS' ELSE 'FAIL' END,
  'fk_constraints_found=' || (SELECT n FROM de_source_fk)

UNION ALL SELECT '10.FK2.snap_store_id_fk',
  CASE WHEN (SELECT n FROM snap_store_fk) >= 1 THEN 'PASS' ELSE 'FAIL' END,
  'fk_constraints_found=' || (SELECT n FROM snap_store_fk)

UNION ALL SELECT '11.T1.v2_updated_at_triggers',
  CASE WHEN (SELECT n FROM v2_updated_at_triggers) >= 1 THEN 'PASS' ELSE 'FAIL' END,
  'trigger_count=' || (SELECT n FROM v2_updated_at_triggers)

UNION ALL SELECT '12.DR1.core_tables_in_db',
  CASE WHEN (SELECT missing FROM missing_core_tables) = 0 THEN 'PASS' ELSE 'FAIL' END,
  'tables_missing_from_db=' || (SELECT missing FROM missing_core_tables)

UNION ALL SELECT '13.DR2.v1_typed_entities_in_db',
  CASE WHEN (SELECT missing FROM missing_v1_entities) = 0 THEN 'PASS'
       WHEN (SELECT missing FROM missing_v1_entities) = 5 THEN 'FAIL (all 5 missing)'
       ELSE 'FAIL' END,
  'v1_entities_missing=' || (SELECT missing FROM missing_v1_entities)

ORDER BY "check";
