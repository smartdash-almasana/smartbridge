-- Add last_error_class column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhook_events'
      AND column_name = 'last_error_class'
  ) THEN
    ALTER TABLE public.webhook_events ADD COLUMN last_error_class text DEFAULT NULL;
  END IF;
END;
$$;

-- DLQ retry index
CREATE INDEX IF NOT EXISTS ix_webhook_events_retry
  ON public.webhook_events (status, next_eligible_at);

-- Updated claim_webhook_events: excludes dead_letter rows
CREATE OR REPLACE FUNCTION public.claim_webhook_events(batch_size integer, worker_id text)
  RETURNS SETOF webhook_events
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.webhook_events w
  SET
    status    = 'processing',
    locked_at = now(),
    locked_by = worker_id,
    attempts  = attempts + 1
  FROM (
    SELECT id
    FROM public.webhook_events
    WHERE
      (
        status = 'pending'
        OR (
          status = 'processing'
          AND locked_at < now() - INTERVAL '5 minutes'
        )
      )
      AND status != 'dead_letter'
      AND (next_eligible_at IS NULL OR next_eligible_at <= now())
    ORDER BY received_at
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE w.id = sub.id
  RETURNING w.*;
END;
$$;

ALTER FUNCTION public.claim_webhook_events(integer, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_webhook_events(integer, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.claim_webhook_events(integer, text) FROM anon, authenticated;;
