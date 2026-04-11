-- SmartSeller V3 — Webhook intake worker support
-- Scope:
--   1) Enable explicit "processing" status in v3_webhook_events
--   2) Persist useful processing error for failed attempts
--   3) Add a concurrency-safe claim RPC using FOR UPDATE SKIP LOCKED

BEGIN;

ALTER TABLE public.v3_webhook_events
  ADD COLUMN IF NOT EXISTS processing_error text;

ALTER TABLE public.v3_webhook_events
  ADD COLUMN IF NOT EXISTS processing_claimed_at timestamptz;

ALTER TABLE public.v3_webhook_events
  DROP CONSTRAINT IF EXISTS v3_webhook_events_processing_status_check;

ALTER TABLE public.v3_webhook_events
  ADD CONSTRAINT v3_webhook_events_processing_status_check
  CHECK (processing_status IN ('pending', 'processing', 'processed', 'error', 'ignored'));

CREATE INDEX IF NOT EXISTS idx_v3_webhook_events_status_claimed_at
  ON public.v3_webhook_events (processing_status, processing_claimed_at, received_at DESC);

DROP FUNCTION IF EXISTS public.v3_claim_webhook_events(integer);
DROP FUNCTION IF EXISTS public.v3_claim_webhook_events(integer, integer);

CREATE OR REPLACE FUNCTION public.v3_claim_webhook_events(
  p_limit integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (webhook_event_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT w.webhook_event_id
    FROM public.v3_webhook_events w
    WHERE w.processing_status = 'pending'
       OR (
         w.processing_status = 'processing'
         AND COALESCE(w.processing_claimed_at, w.received_at) <= now() - make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 300), 30))
       )
    ORDER BY w.received_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  ),
  claimed AS (
    UPDATE public.v3_webhook_events w
    SET processing_status = 'processing',
        processing_claimed_at = now(),
        processing_error = NULL
    FROM candidate c
    WHERE w.webhook_event_id = c.webhook_event_id
    RETURNING w.webhook_event_id
  )
  SELECT c.webhook_event_id
  FROM claimed c;
END;
$$;

COMMIT;
