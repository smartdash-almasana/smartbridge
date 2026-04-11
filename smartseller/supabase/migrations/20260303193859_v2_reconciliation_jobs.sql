-- ─── v2_reconciliation_jobs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_reconciliation_jobs (
    job_id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id         uuid        NOT NULL REFERENCES public.v2_stores(store_id) ON DELETE CASCADE,
    scope            text        NOT NULL CHECK (scope IN ('orders')),
    cursor           jsonb       NULL,
    status           text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','running','done','failed','dead_letter')),
    attempts         integer     NOT NULL DEFAULT 0,
    next_eligible_at timestamptz NOT NULL DEFAULT now(),
    locked_at        timestamptz NULL,
    locked_by        text        NULL,
    last_error       text        NULL,
    dead_letter_at   timestamptz NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_v2_reconciliation_jobs_store_scope UNIQUE (store_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_v2_reconciliation_jobs_status_eligible
    ON public.v2_reconciliation_jobs (status, next_eligible_at, created_at);

CREATE INDEX IF NOT EXISTS idx_v2_reconciliation_jobs_locked
    ON public.v2_reconciliation_jobs (locked_by, locked_at)
    WHERE locked_by IS NOT NULL;

-- ─── RPC claim atómica con SKIP LOCKED ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.v2_claim_reconciliation_jobs(
    p_limit  integer,
    p_worker text,
    p_scope  text DEFAULT 'orders'
)
RETURNS TABLE (
    job_id           uuid,
    store_id         uuid,
    scope            text,
    cursor           jsonb,
    attempts         integer
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT j.job_id
        FROM public.v2_reconciliation_jobs j
        WHERE j.status IN ('pending', 'failed')
          AND j.scope = p_scope
          AND j.next_eligible_at <= now()
        ORDER BY j.next_eligible_at ASC, j.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.v2_reconciliation_jobs t
    SET
        status     = 'running',
        locked_at  = now(),
        locked_by  = p_worker,
        updated_at = now()
    FROM claimed c
    WHERE t.job_id = c.job_id
    RETURNING t.job_id, t.store_id, t.scope, t.cursor, t.attempts;
END;
$$;;
