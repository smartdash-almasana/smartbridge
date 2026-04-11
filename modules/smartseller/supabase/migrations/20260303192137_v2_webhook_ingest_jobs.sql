-- ─── v2_webhook_ingest_jobs: queue paralela de procesamiento ingest ───────────
CREATE TABLE IF NOT EXISTS public.v2_webhook_ingest_jobs (
    event_id        uuid        PRIMARY KEY
                                REFERENCES public.v2_webhook_events(event_id) ON DELETE CASCADE,
    status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','running','done','failed','dead_letter')),
    attempts        integer     NOT NULL DEFAULT 0,
    next_eligible_at timestamptz NOT NULL DEFAULT now(),
    locked_at       timestamptz NULL,
    locked_by       text        NULL,
    last_error      text        NULL,
    dead_letter_at  timestamptz NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v2_webhook_ingest_jobs_status_eligible
    ON public.v2_webhook_ingest_jobs (status, next_eligible_at, created_at);

CREATE INDEX IF NOT EXISTS idx_v2_webhook_ingest_jobs_locked
    ON public.v2_webhook_ingest_jobs (locked_by, locked_at)
    WHERE locked_by IS NOT NULL;

-- ─── RPC claim atómica con SKIP LOCKED ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.v2_claim_webhook_ingest_jobs(
    p_limit  integer,
    p_worker text
)
RETURNS TABLE (event_id uuid, attempts integer)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT j.event_id
        FROM public.v2_webhook_ingest_jobs j
        WHERE j.status IN ('pending', 'failed')
          AND j.next_eligible_at <= now()
        ORDER BY j.next_eligible_at ASC, j.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.v2_webhook_ingest_jobs t
    SET
        status     = 'running',
        locked_at  = now(),
        locked_by  = p_worker,
        updated_at = now()
    FROM claimed c
    WHERE t.event_id = c.event_id
    RETURNING t.event_id, t.attempts;
END;
$$;;
