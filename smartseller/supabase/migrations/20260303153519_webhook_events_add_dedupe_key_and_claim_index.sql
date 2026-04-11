ALTER TABLE IF EXISTS public.webhook_events
ADD COLUMN IF NOT EXISTS dedupe_key text;

UPDATE public.webhook_events
SET dedupe_key = CASE
  WHEN provider_event_id IS NOT NULL AND btrim(provider_event_id) <> ''
    THEN provider || ':' || provider_event_id
  ELSE provider || ':' || topic || ':' || resource || ':' || id::text
END
WHERE dedupe_key IS NULL;

ALTER TABLE public.webhook_events
ALTER COLUMN dedupe_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_dedupe_key
  ON public.webhook_events (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_webhook_events_claim
  ON public.webhook_events (status, next_eligible_at, received_at DESC);;
