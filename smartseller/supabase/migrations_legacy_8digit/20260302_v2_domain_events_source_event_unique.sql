-- ============================================================================
-- SmartSeller V2 — Idempotency constraint for v2_domain_events worker
-- Date: 2026-03-02
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_domain_events_source_event
  ON public.v2_domain_events (source_event_id)
  WHERE source_event_id IS NOT NULL;
