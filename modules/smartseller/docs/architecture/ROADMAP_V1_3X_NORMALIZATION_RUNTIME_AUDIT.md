# Roadmap V1 3.x — Normalizacion & Entidades (Repo Audit + QA Skeleton)

## 1) Inventario de schema y pipeline (evidencia repo)
- `v2_webhook_events` existe en migracion: [supabase/migrations/20260302_v2_webhook_events.sql:9](e:/BuenosPasos/smartseller-v2/supabase/migrations/20260302_v2_webhook_events.sql:9).
- `v2_domain_events` **no tiene CREATE TABLE en `supabase/migrations`**; si hay evidencia de uso e idempotencia por indice: [supabase/migrations/20260302_v2_domain_events_source_event_unique.sql:6](e:/BuenosPasos/smartseller-v2/supabase/migrations/20260302_v2_domain_events_source_event_unique.sql:6), [docs/adr/ADR-0005-ingest-observability.md:38](e:/BuenosPasos/smartseller-v2/docs/adr/ADR-0005-ingest-observability.md:38).
- `v2_snapshots` **no tiene CREATE TABLE en `supabase/migrations`**; aparece solo como tabla consumida/escrita: [src/v2/api/score.ts:279](e:/BuenosPasos/smartseller-v2/src/v2/api/score.ts:279), [docs/qa/QA_AUTOMATION_SYSTEM.sql:57](e:/BuenosPasos/smartseller-v2/docs/qa/QA_AUTOMATION_SYSTEM.sql:57).
- Core tables `orders/fulfillments/refunds/payments`: **no CREATE TABLE encontrado en `supabase/migrations`** (solo referencias de dominio/eventos).
- `v2_metrics_daily`: usada por codigo [src/v2/api/score.ts:113](e:/BuenosPasos/smartseller-v2/src/v2/api/score.ts:113), pero **sin CREATE TABLE en `supabase/migrations`**.
- Quien escribe `v2_domain_events` hoy:
  - Worker ingest: [src/v2/ingest/webhook-to-domain-worker.ts:100](e:/BuenosPasos/smartseller-v2/src/v2/ingest/webhook-to-domain-worker.ts:100).
  - Normalizer: [src/v2/ingest/normalizer.ts:80](e:/BuenosPasos/smartseller-v2/src/v2/ingest/normalizer.ts:80).
  - Sync ML manual: [src/app/(v2)/api/meli/sync/[store_id]/route.ts:167](e:/BuenosPasos/smartseller-v2/src/app/(v2)/api/meli/sync/[store_id]/route.ts:167).
  - Reconcile worker: [src/app/(v2)/api/worker/meli-reconcile/route.ts:83](e:/BuenosPasos/smartseller-v2/src/app/(v2)/api/worker/meli-reconcile/route.ts:83).
- Quien escribe `v2_snapshots` hoy: score pipeline [src/v2/api/score.ts:272](e:/BuenosPasos/smartseller-v2/src/v2/api/score.ts:272).
- `event_type/entity_type` existentes en codigo:
  - `order.updated/payment.updated/question.received/message.received` + fallback unknown: [src/v2/ingest/normalizer.ts:17](e:/BuenosPasos/smartseller-v2/src/v2/ingest/normalizer.ts:17).
  - `order.created/order.cancelled` desde sync: [src/app/(v2)/api/meli/sync/[store_id]/route.ts:109](e:/BuenosPasos/smartseller-v2/src/app/(v2)/api/meli/sync/[store_id]/route.ts:109).
  - `order.reconciled` desde reconcile: [src/app/(v2)/api/worker/meli-reconcile/route.ts:88](e:/BuenosPasos/smartseller-v2/src/app/(v2)/api/worker/meli-reconcile/route.ts:88).
  - Score consume `order.created/order.cancelled/message.received/message.answered/claim.opened`: [src/v2/api/score.ts:97](e:/BuenosPasos/smartseller-v2/src/v2/api/score.ts:97).

## 2) Decision A/B para V1
- A) Core normalizado minimo (`orders/fulfillments/payments/refunds` + raw `jsonb` evidence).
- B) Snapshots-only + views/materialized.
- Recomendacion: **A (core minimo)**.
- Justificacion (determinismo + costo): A fija identidad/UNIQUE por entidad y evita drift semantico entre productores de `event_type`; costo incremental bajo si se limita a 4 tablas + evidencia `jsonb`. B reduce escritura inicial, pero desplaza complejidad a vistas y aumenta riesgo de resultados no deterministas por cambios en mapeo/eventos historicos.

## 3) Contrato minimo (delta funcional, sin refactor mayor)
- Identidad canonica por fila: `tenant_id`, `store_id`, `seller_uuid` (si existe en dominio de negocio), `provider_key`, `external_id`.
- UNIQUE minimos por entidad:
  - `orders`: `(store_id, provider_key, external_id)`.
  - `payments`: `(store_id, provider_key, external_id)`.
  - `refunds`: `(store_id, provider_key, external_id)`.
  - `fulfillments`: `(store_id, provider_key, external_id)`.
- Reglas ML->canonical:
  - Status mapping explicito (sin mezclar `order.updated` vs `order.created/cancelled` en la misma metrica final).
  - Parciales: soportar N pagos/reembolsos por orden (no colapsar por `order_id`).
  - Multi-location: fulfillment debe incluir `location_id`/nodo logico.
  - Multi-currency: persistir `amount` + `currency` por transaccion.
  - `Refund != Transaction`: refund como entidad separada (no sobreescribir payment).

## 4) DoD 3.x + QA skeleton (SELECT-only, PASS/FAIL)
- DoD-1: existe una sola identidad canonica por entidad (`UNIQUE` efectivo, sin duplicados por `external_id`).
- DoD-2: reconciliacion evento->entidad trazable (cada record core tiene evidencia `jsonb` + referencia de origen).
- DoD-3: score/snapshots leen datos consistentes sin depender de interpretaciones ambiguas de `event_type`.

```sql
-- QA_AUTOMATION_V1_3X_SKELETON.sql (SELECT-only)
WITH
  dup_orders AS (
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT store_id, provider_key, external_id
      FROM public.orders
      GROUP BY store_id, provider_key, external_id
      HAVING COUNT(*) > 1
    ) t
  ),
  dup_payments AS (
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT store_id, provider_key, external_id
      FROM public.payments
      GROUP BY store_id, provider_key, external_id
      HAVING COUNT(*) > 1
    ) t
  ),
  orphan_refunds AS (
    SELECT COUNT(*)::int AS n
    FROM public.refunds r
    LEFT JOIN public.payments p ON p.store_id=r.store_id AND p.external_id=r.payment_external_id
    WHERE p.external_id IS NULL
  ),
  currency_missing AS (
    SELECT COUNT(*)::int AS n
    FROM public.payments
    WHERE amount IS NULL OR currency IS NULL OR btrim(currency)=''
  ),
  snapshot_freshness AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_stores s
    JOIN public.v2_oauth_tokens t ON t.store_id=s.store_id AND t.status='active'
    WHERE s.provider_key='mercadolibre'
      AND NOT EXISTS (
        SELECT 1 FROM public.v2_snapshots snap
        WHERE snap.store_id=s.store_id
          AND snap.snapshot_at >= now() - interval '24 hours'
      )
  )
SELECT '1.dup_orders' AS "check", CASE WHEN (SELECT n FROM dup_orders)=0 THEN 'PASS' ELSE 'FAIL' END AS status, 'duplicates='||(SELECT n FROM dup_orders) AS detail
UNION ALL
SELECT '2.dup_payments', CASE WHEN (SELECT n FROM dup_payments)=0 THEN 'PASS' ELSE 'FAIL' END, 'duplicates='||(SELECT n FROM dup_payments)
UNION ALL
SELECT '3.orphan_refunds', CASE WHEN (SELECT n FROM orphan_refunds)=0 THEN 'PASS' ELSE 'FAIL' END, 'orphans='||(SELECT n FROM orphan_refunds)
UNION ALL
SELECT '4.currency_missing', CASE WHEN (SELECT n FROM currency_missing)=0 THEN 'PASS' ELSE 'FAIL' END, 'missing='||(SELECT n FROM currency_missing)
UNION ALL
SELECT '5.snapshot_freshness_24h', CASE WHEN (SELECT n FROM snapshot_freshness)=0 THEN 'PASS' ELSE 'FAIL' END, 'stores_missing='||(SELECT n FROM snapshot_freshness)
ORDER BY 1;
```
