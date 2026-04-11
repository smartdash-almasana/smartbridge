-- =============================================================================
-- OBSERVABILITY METRICS - SmartSeller Engine (Syntax Fix)
-- =============================================================================

-- VIEW 1: queue_health
CREATE OR REPLACE VIEW public.queue_health AS
SELECT
    count(*) FILTER (WHERE status = 'pending') AS pending_count,
    count(*) FILTER (WHERE status = 'processing') AS processing_count,
    count(*) FILTER (WHERE status = 'failed') AS failed_count,
    COALESCE(
        EXTRACT(EPOCH FROM (
            now() - (
                min(received_at) FILTER (WHERE status = 'pending')
            )
        )),
        0
    ) AS oldest_pending_age_seconds
FROM public.webhook_events;

-- VIEW 2: processing_latency
CREATE OR REPLACE VIEW public.processing_latency AS
SELECT
    COALESCE(AVG(EXTRACT(EPOCH FROM (processed_at - received_at))), 0) AS avg_seconds_to_process,
    COALESCE(MAX(EXTRACT(EPOCH FROM (processed_at - received_at))), 0) AS max_seconds_to_process,
    COALESCE(MAX(processed_at), now()) AS last_processed_at
FROM public.webhook_events
WHERE status IN ('processed', 'done')
  AND processed_at > (now() - INTERVAL '1 hour');

-- VIEW 3: retry_monitor
CREATE OR REPLACE VIEW public.retry_monitor AS
SELECT
    count(*) FILTER (WHERE attempts > 1) AS events_with_retries,
    COALESCE(MAX(attempts), 0) AS max_attempts,
    count(*) FILTER (WHERE attempts >= 3) AS events_over_3_attempts
FROM public.webhook_events
WHERE status IN ('pending', 'processing', 'failed');

-- VIEW 4: lock_status
CREATE OR REPLACE VIEW public.lock_status AS
SELECT
    job_key,
    locked_by,
    ROUND(EXTRACT(EPOCH FROM (locked_until - now()))) AS seconds_until_unlock
FROM public.job_locks
WHERE locked_until > now();

-- Grant access
GRANT SELECT ON public.queue_health TO authenticated, service_role;
GRANT SELECT ON public.processing_latency TO authenticated, service_role;
GRANT SELECT ON public.retry_monitor TO authenticated, service_role;
GRANT SELECT ON public.lock_status TO authenticated, service_role;;
