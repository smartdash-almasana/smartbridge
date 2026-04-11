# Audit — v2_webhook_events Migration

## SQL completo

```sql
-- ============================================================================
-- SmartSeller V2 — Official migration: v2_webhook_events
-- Date: 2026-03-02
-- Purpose: define webhook ingest table and idempotency indexes
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.v2_webhook_events (
  event_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           uuid NOT NULL REFERENCES public.v2_stores(store_id) ON DELETE RESTRICT,
  provider_event_id  text NOT NULL,
  topic              text NOT NULL,
  resource           text,
  provider_user_id   text,
  raw_payload        jsonb,
  received_at        timestamptz NOT NULL DEFAULT now(),
  tenant_id          uuid,
  dedupe_key         text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_webhook_events_store_event
  ON public.v2_webhook_events (store_id, provider_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_webhook_events_store_dedupe
  ON public.v2_webhook_events (store_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_v2_webhook_events_received_at
  ON public.v2_webhook_events (store_id, received_at DESC);

COMMIT;
```

## Justificación
- Formaliza en migraciones versionadas la estructura operativa actual de `v2_webhook_events`.
- Formaliza idempotencia por `store_id + provider_event_id`.
- Formaliza deduplicación alternativa por `store_id + dedupe_key` cuando `dedupe_key` está presente.
- Formaliza índice de lectura temporal por store: `(store_id, received_at DESC)`.

## Confirmación de reproducibilidad
- La definición queda en `supabase/migrations/20260302_v2_webhook_events.sql`.
- El uso de `IF NOT EXISTS` en tabla e índices permite ejecución repetible sin error por objetos ya existentes.
- La migración no modifica handlers ni lógica de negocio; solo declara estructura persistente.

## Estado final
**OK**
