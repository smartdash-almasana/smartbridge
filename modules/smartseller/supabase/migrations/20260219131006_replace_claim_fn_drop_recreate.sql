-- Cannot use CREATE OR REPLACE to remove defaults; must DROP and recreate.
-- Callers in webhook-worker.ts and route.ts always pass both args explicitly,
-- so removing defaults is safe and matches nuevadb.sql canonical signature.
DROP FUNCTION IF EXISTS public.claim_webhook_events(integer, text);

CREATE FUNCTION public.claim_webhook_events(
  batch_size int,
  worker_id  text
)
RETURNS SETOF public.webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      AND (next_eligible_at IS NULL OR next_eligible_at <= now())
    ORDER BY received_at
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE w.id = sub.id
  RETURNING w.*;
END;
$$;

ALTER  FUNCTION public.claim_webhook_events(int, text) OWNER TO postgres;
REVOKE ALL     ON FUNCTION public.claim_webhook_events(int, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.claim_webhook_events(int, text) FROM anon, authenticated;;
