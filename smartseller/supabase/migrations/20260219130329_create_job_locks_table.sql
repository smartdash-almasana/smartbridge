CREATE TABLE IF NOT EXISTS public.job_locks (
    job_key      text        NOT NULL,
    locked_until timestamptz NOT NULL,
    locked_by    text        NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_locks_pkey PRIMARY KEY (job_key)
);;
