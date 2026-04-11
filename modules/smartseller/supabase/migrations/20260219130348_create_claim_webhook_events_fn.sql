CREATE OR REPLACE FUNCTION public.claim_webhook_events(
    batch_size  integer DEFAULT 25,
    worker_id   text    DEFAULT 'anonymous-worker'
)
RETURNS SETOF public.webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now          timestamptz := now();
    v_stale_cutoff timestamptz := now() - INTERVAL '5 minutes';
BEGIN
    IF batch_size IS NULL OR batch_size < 1 THEN
        batch_size := 25;
    END IF;
    IF batch_size > 500 THEN
        RAISE EXCEPTION
            'claim_webhook_events: batch_size % exceeds maximum of 500',
            batch_size
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    RETURN QUERY
    WITH to_claim AS (
        SELECT id
        FROM public.webhook_events
        WHERE
            status = 'pending'
            AND (locked_at IS NULL OR locked_at < v_stale_cutoff)
            AND (next_eligible_at IS NULL OR next_eligible_at <= v_now)
        ORDER BY received_at ASC
        LIMIT batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.webhook_events t
    SET
        status    = 'processing',
        locked_at = v_now,
        locked_by = worker_id,
        attempts  = t.attempts + 1
    FROM to_claim
    WHERE t.id = to_claim.id
    RETURNING t.*;
END;
$$;

ALTER  FUNCTION public.claim_webhook_events(integer, text) OWNER TO postgres;
REVOKE ALL     ON FUNCTION public.claim_webhook_events(integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_webhook_events(integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_webhook_events(integer, text) FROM authenticated;;
