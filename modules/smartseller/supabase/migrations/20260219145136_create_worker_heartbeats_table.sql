CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
    worker_id    text        NOT NULL,
    last_seen_at timestamptz NOT NULL,
    instance_id  text        DEFAULT NULL,
    version      text        DEFAULT NULL,
    CONSTRAINT worker_heartbeats_pkey PRIMARY KEY (worker_id)
);

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.worker_heartbeats FROM anon, authenticated;;
