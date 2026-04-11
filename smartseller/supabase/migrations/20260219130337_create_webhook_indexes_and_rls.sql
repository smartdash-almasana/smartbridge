CREATE INDEX IF NOT EXISTS idx_webhook_events_claimable
    ON public.webhook_events (received_at ASC)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_webhook_events_status_received
    ON public.webhook_events (status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_seller_topic
    ON public.webhook_events (provider_seller_id, topic, received_at DESC);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_locks      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_webhook_events ON public.webhook_events;
DROP POLICY IF EXISTS deny_all_job_locks      ON public.job_locks;;
