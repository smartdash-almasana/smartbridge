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
