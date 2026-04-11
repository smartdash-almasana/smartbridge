-- 20260303_token_refresh.sql
CREATE TABLE IF NOT EXISTS public.token_refresh_jobs (
    store_id uuid PRIMARY KEY,
    status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    next_eligible_at timestamp with time zone NOT NULL DEFAULT now(),
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    dead_letter_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT token_refresh_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'dead_letter'::text])))
);

CREATE INDEX IF NOT EXISTS idx_token_refresh_jobs_status_next_created ON public.token_refresh_jobs USING btree (status, next_eligible_at, created_at);
CREATE INDEX IF NOT EXISTS idx_token_refresh_jobs_locked ON public.token_refresh_jobs USING btree (locked_by, locked_at);

CREATE TABLE IF NOT EXISTS public.v2_worker_heartbeats (
    worker_name text NOT NULL,
    worker_instance text NOT NULL,
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    meta jsonb,
    CONSTRAINT v2_worker_heartbeats_pkey PRIMARY KEY (worker_name, worker_instance)
);

CREATE TABLE IF NOT EXISTS public.v2_runtime_metrics_minute (
    bucket_minute timestamp with time zone NOT NULL,
    worker_name text NOT NULL,
    scanned integer DEFAULT 0,
    enqueued integer DEFAULT 0,
    claimed integer DEFAULT 0,
    processed integer DEFAULT 0,
    failed integer DEFAULT 0,
    dead_letter integer DEFAULT 0,
    avg_latency_ms integer,
    CONSTRAINT v2_runtime_metrics_minute_pkey PRIMARY KEY (bucket_minute, worker_name)
);

DROP FUNCTION IF EXISTS public.v2_claim_token_refresh_jobs(integer, text);
CREATE OR REPLACE FUNCTION public.v2_claim_token_refresh_jobs(p_limit integer, p_worker text)
 RETURNS TABLE(store_id uuid, attempts integer, status text, next_eligible_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT trj.store_id
        FROM public.token_refresh_jobs trj
        WHERE trj.status IN ('pending', 'failed')
          AND trj.next_eligible_at <= now()
        ORDER BY trj.next_eligible_at ASC, trj.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.token_refresh_jobs
    SET status = 'running',
        locked_at = now(),
        locked_by = p_worker,
        updated_at = now()
    FROM claimed
    WHERE token_refresh_jobs.store_id = claimed.store_id
    RETURNING token_refresh_jobs.store_id, token_refresh_jobs.attempts, token_refresh_jobs.status, token_refresh_jobs.next_eligible_at;
END;
$function$;
