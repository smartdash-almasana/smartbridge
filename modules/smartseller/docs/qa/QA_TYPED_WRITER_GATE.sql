-- ─────────────────────────────────────────────────────────────────────────────
-- QA Gate: Typed Writer (Phase 2.B Prep)
-- Archivo: docs/qa/QA_TYPED_WRITER_GATE.sql
-- Objetivo: Validar la coherencia e integridad de las tablas tipadas V1 
-- post-inserción del Typed Writer.
-- No modifica datos. Solo SELECT (PASS/FAIL).
-- ─────────────────────────────────────────────────────────────────────────────

WITH
  -- ── W0: Fails / DLQ (Verificación de existencia y count) ───────────────────
  w0_dlq_exists AS (
    SELECT COUNT(*)::int AS n 
    FROM information_schema.tables 
    WHERE table_schema='public' AND table_name='v2_dlq_events'
  ),

  -- ── W1: Coherencia de FK (Orphans) ─────────────────────────────────────────
  w1_orphans_items AS (
    SELECT COUNT(*)::int AS n FROM public.v2_order_items i
    LEFT JOIN public.v2_orders o 
      ON i.store_id = o.store_id AND i.order_external_id = o.order_external_id
    WHERE o.order_id IS NULL
  ),
  w1_orphans_fulfillments AS (
    SELECT COUNT(*)::int AS n FROM public.v2_fulfillments f
    LEFT JOIN public.v2_orders o 
      ON f.store_id = o.store_id AND f.order_external_id = o.order_external_id
    WHERE o.order_id IS NULL
  ),
  -- Para payments/refunds, el contrato (V1_CORE_ENTITIES_SPEC.md) permite
  -- order_external_id = NULL. Solo son huérfanos si tienen order_external_id
  -- pero esa orden NO existe.
  w1_orphans_payments AS (
    SELECT COUNT(*)::int AS n FROM public.v2_payments p
    LEFT JOIN public.v2_orders o 
      ON p.store_id = o.store_id AND p.order_external_id = o.order_external_id
    WHERE p.order_external_id IS NOT NULL AND o.order_id IS NULL
  ),
  w1_orphans_refunds AS (
    SELECT COUNT(*)::int AS n FROM public.v2_refunds r
    LEFT JOIN public.v2_orders o 
      ON r.store_id = o.store_id AND r.order_external_id = o.order_external_id
    WHERE r.order_external_id IS NOT NULL AND o.order_id IS NULL
  ),

  -- ── W2: Idempotencia (Duplicados de provider identity) ─────────────────────
  -- La BD ya cuenta con UNIQUE constraints, pero verificamos la limpieza bruta.
  w2_duplicates_orders AS (
    SELECT COUNT(*)::int AS n FROM (
      SELECT store_id, provider_key, order_external_id 
      FROM public.v2_orders 
      GROUP BY store_id, provider_key, order_external_id 
      HAVING COUNT(*) > 1
    ) sq
  ),
  w2_duplicates_items AS (
    SELECT COUNT(*)::int AS n FROM (
      SELECT store_id, provider_key, order_external_id, line_external_id 
      FROM public.v2_order_items 
      GROUP BY store_id, provider_key, order_external_id, line_external_id 
      HAVING COUNT(*) > 1
    ) sq
  ),

  -- ── W3: Tenant Scoping (Cross-Tenant pollution) ────────────────────────────
  -- Comprobamos que un registro hijo tenga el mismo tenant_id que su orden padre.
  w3_cross_tenant_items AS (
    SELECT COUNT(*)::int AS n FROM public.v2_order_items i
    JOIN public.v2_orders o 
      ON i.store_id = o.store_id AND i.order_external_id = o.order_external_id
    WHERE i.tenant_id != o.tenant_id
  ),
  w3_cross_tenant_fulfillments AS (
    SELECT COUNT(*)::int AS n FROM public.v2_fulfillments f
    JOIN public.v2_orders o 
      ON f.store_id = o.store_id AND f.order_external_id = o.order_external_id
    WHERE f.tenant_id != o.tenant_id
  ),

  -- ── W4: Basic Non-zeroness after writer ────────────────────────────────────
  w4_orders_nonzero AS (
    SELECT COUNT(*)::int AS n FROM public.v2_orders
  ),

  -- ── W6: Items from fan-out writer ───────────────────────────────────────────
  w6_items_nonzero AS (
    SELECT COUNT(*)::int AS n FROM public.v2_order_items
  ),

  -- ── W7: No duplicates in order_items ────────────────────────────────────────
  w7_items_duplicates AS (
    SELECT COUNT(*)::int AS n FROM (
      SELECT store_id, provider_key, order_external_id, line_external_id
      FROM public.v2_order_items
      GROUP BY store_id, provider_key, order_external_id, line_external_id
      HAVING COUNT(*) > 1
    ) sq
  ),

  -- ── W8: Payments from writer ────────────────────────────────────────────────
  w8_payments_nonzero AS (
    SELECT COUNT(*)::int AS n FROM public.v2_payments
  ),

  -- ── W9: Refunds from writer ─────────────────────────────────────────────────
  w9_refunds_nonzero AS (
    SELECT COUNT(*)::int AS n FROM public.v2_refunds
  ),

  -- ── W10: No duplicates in payments ──────────────────────────────────────────
  w10_payments_duplicates AS (
    SELECT COUNT(*)::int AS n FROM (
      SELECT store_id, provider_key, payment_external_id
      FROM public.v2_payments
      GROUP BY store_id, provider_key, payment_external_id
      HAVING COUNT(*) > 1
    ) sq
  ),

  -- ── W11: No duplicates in refunds ───────────────────────────────────────────
  w11_refunds_duplicates AS (
    SELECT COUNT(*)::int AS n FROM (
      SELECT store_id, provider_key, refund_external_id
      FROM public.v2_refunds
      GROUP BY store_id, provider_key, refund_external_id
      HAVING COUNT(*) > 1
    ) sq
  )

-- ── RESULTADOS SELECT ────────────────────────────────────────────────────────
SELECT 
  'W0.dlq_table_exists' AS "check", 
  CASE WHEN (SELECT n FROM w0_dlq_exists) = 1 THEN 'PASS' ELSE 'FAIL (GAP)' END AS status, 
  'dlq_tables=' || (SELECT n FROM w0_dlq_exists) AS detail
UNION ALL
SELECT 
  'W1.orphans_in_items', CASE WHEN (SELECT n FROM w1_orphans_items)=0 THEN 'PASS' ELSE 'FAIL' END, 'orphans='||(SELECT n FROM w1_orphans_items)
UNION ALL
SELECT 
  'W1.orphans_in_fulfillments', CASE WHEN (SELECT n FROM w1_orphans_fulfillments)=0 THEN 'PASS' ELSE 'FAIL' END, 'orphans='||(SELECT n FROM w1_orphans_fulfillments)
UNION ALL
SELECT 
  'W1.orphans_in_payments', CASE WHEN (SELECT n FROM w1_orphans_payments)=0 THEN 'PASS' ELSE 'FAIL' END, 'orphans='||(SELECT n FROM w1_orphans_payments)
UNION ALL
SELECT 
  'W1.orphans_in_refunds', CASE WHEN (SELECT n FROM w1_orphans_refunds)=0 THEN 'PASS' ELSE 'FAIL' END, 'orphans='||(SELECT n FROM w1_orphans_refunds)
UNION ALL
SELECT 
  'W2/W5.duplicates_in_orders', CASE WHEN (SELECT n FROM w2_duplicates_orders)=0 THEN 'PASS' ELSE 'FAIL' END, 'dup_groups='||(SELECT n FROM w2_duplicates_orders)
UNION ALL
SELECT 
  'W2.duplicates_in_items', CASE WHEN (SELECT n FROM w2_duplicates_items)=0 THEN 'PASS' ELSE 'FAIL' END, 'dup_groups='||(SELECT n FROM w2_duplicates_items)
UNION ALL
SELECT 
  'W3.cross_tenant_items', CASE WHEN (SELECT n FROM w3_cross_tenant_items)=0 THEN 'PASS' ELSE 'FAIL' END, 'cross_rows='||(SELECT n FROM w3_cross_tenant_items)
UNION ALL
SELECT 
  'W3.cross_tenant_fulfillments', CASE WHEN (SELECT n FROM w3_cross_tenant_fulfillments)=0 THEN 'PASS' ELSE 'FAIL' END, 'cross_rows='||(SELECT n FROM w3_cross_tenant_fulfillments)
UNION ALL
SELECT 
  'W4.orders_nonzero_or_skip', CASE WHEN (SELECT n FROM w4_orders_nonzero) > 0 THEN 'PASS' ELSE 'SKIP (0 orders)' END, 'orders='||(SELECT n FROM w4_orders_nonzero)
UNION ALL
SELECT 
  'W6.items_nonzero_or_skip', CASE WHEN (SELECT n FROM w4_orders_nonzero) = 0 THEN 'SKIP (0 orders)' WHEN (SELECT n FROM w6_items_nonzero) > 0 THEN 'PASS' ELSE 'SKIP (items payload empty)' END, 'items='||(SELECT n FROM w6_items_nonzero)
UNION ALL
SELECT 
  'W7.items_duplicates', CASE WHEN (SELECT n FROM w7_items_duplicates)=0 THEN 'PASS' ELSE 'FAIL' END, 'dup_groups='||(SELECT n FROM w7_items_duplicates)
UNION ALL
SELECT 
  'W8.payments_nonzero_or_skip', CASE WHEN (SELECT n FROM w8_payments_nonzero) > 0 THEN 'PASS' ELSE 'SKIP (0 payments)' END, 'payments='||(SELECT n FROM w8_payments_nonzero)
UNION ALL
SELECT 
  'W9.refunds_nonzero_or_skip', CASE WHEN (SELECT n FROM w9_refunds_nonzero) > 0 THEN 'PASS' ELSE 'SKIP (0 refunds)' END, 'refunds='||(SELECT n FROM w9_refunds_nonzero)
UNION ALL
SELECT 
  'W10.payments_duplicates', CASE WHEN (SELECT n FROM w10_payments_duplicates)=0 THEN 'PASS' ELSE 'FAIL' END, 'dup_groups='||(SELECT n FROM w10_payments_duplicates)
UNION ALL
SELECT 
  'W11.refunds_duplicates', CASE WHEN (SELECT n FROM w11_refunds_duplicates)=0 THEN 'PASS' ELSE 'FAIL' END, 'dup_groups='||(SELECT n FROM w11_refunds_duplicates)
ORDER BY "check";
