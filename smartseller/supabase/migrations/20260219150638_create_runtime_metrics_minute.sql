-- ============================================================
-- SmartSeller – Runtime Throughput Metrics
-- Migration: 008_runtime_metrics_minute.sql
-- Additive. No triggers. No FK. No cascade. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.runtime_metrics_minute (
    bucket_minute      timestamptz NOT NULL,
    worker_id          text        NOT NULL,
    claimed_count      integer     NOT NULL DEFAULT 0,
    processed_count    integer     NOT NULL DEFAULT 0,
    failed_count       integer     NOT NULL DEFAULT 0,
    dead_letter_count  integer     NOT NULL DEFAULT 0,
    avg_latency_ms     numeric     NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT runtime_metrics_minute_pkey PRIMARY KEY (bucket_minute, worker_id)
);

CREATE INDEX IF NOT EXISTS ix_runtime_metrics_minute_bucket
    ON public.runtime_metrics_minute (bucket_minute DESC);

ALTER TABLE public.runtime_metrics_minute ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.runtime_metrics_minute FROM anon, authenticated;;
