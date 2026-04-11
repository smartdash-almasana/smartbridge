-- ─── A) token_refresh_jobs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.token_refresh_jobs (
    store_id        uuid        PRIMARY KEY,
    status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','running','done','failed','dead_letter')),
    attempts        int         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_eligible_at timestamptz NOT NULL DEFAULT now(),
    locked_at       timestamptz NULL,
    locked_by       text        NULL,
    last_error      text        NULL,
    dead_letter_at  timestamptz NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT lock_consistency CHECK (
        (locked_by IS NULL AND locked_at IS NULL) OR
        (locked_by IS NOT NULL AND locked_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_token_refresh_jobs_status_eligible
    ON public.token_refresh_jobs (status, next_eligible_at);

CREATE INDEX IF NOT EXISTS idx_token_refresh_jobs_locked
    ON public.token_refresh_jobs (locked_by, locked_at)
    WHERE locked_by IS NOT NULL;

-- ─── B) v2_worker_heartbeats ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_worker_heartbeats (
    worker_name     text        NOT NULL,
    worker_instance text        NOT NULL,
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    meta            jsonb       NULL,
    PRIMARY KEY (worker_name, worker_instance)
);

-- ─── C) v2_runtime_metrics_minute ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_runtime_metrics_minute (
    bucket_minute   timestamptz NOT NULL,
    worker_name     text        NOT NULL,
    scanned         int         NOT NULL DEFAULT 0,
    claimed         int         NOT NULL DEFAULT 0,
    processed       int         NOT NULL DEFAULT 0,
    failed          int         NOT NULL DEFAULT 0,
    dead_letter     int         NOT NULL DEFAULT 0,
    avg_latency_ms  int         NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bucket_minute, worker_name)
);

-- ─── RPC: v2_claim_token_refresh_jobs ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.v2_claim_token_refresh_jobs(
    p_limit  int,
    p_worker text
)
RETURNS TABLE (
    store_id         uuid,
    attempts         int,
    next_eligible_at timestamptz,
    last_error       text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT j.store_id
        FROM public.token_refresh_jobs j
        WHERE j.status IN ('pending', 'failed')
          AND j.next_eligible_at <= now()
        ORDER BY j.next_eligible_at ASC, j.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.token_refresh_jobs t
    SET
        status   = 'running',
        locked_at = now(),
        locked_by = p_worker,
        updated_at = now()
    FROM claimed c
    WHERE t.store_id = c.store_id
    RETURNING
        t.store_id,
        t.attempts,
        t.next_eligible_at,
        t.last_error;
END;
$$;;
