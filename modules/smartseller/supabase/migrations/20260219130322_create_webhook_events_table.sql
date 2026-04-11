CREATE TABLE IF NOT EXISTS public.webhook_events (
    id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
    provider           text        NOT NULL,
    provider_event_id  text        NOT NULL,
    provider_seller_id text,
    topic              text        NOT NULL DEFAULT 'unknown',
    resource           text        NOT NULL DEFAULT 'unknown',
    raw_payload        jsonb,
    user_id            text,
    status             text        NOT NULL DEFAULT 'pending',
    attempts           integer     NOT NULL DEFAULT 0,
    received_at        timestamptz NOT NULL DEFAULT now(),
    next_eligible_at   timestamptz          DEFAULT NULL,
    locked_at          timestamptz          DEFAULT NULL,
    locked_by          text                 DEFAULT NULL,
    processed_at       timestamptz          DEFAULT NULL,
    last_error         text                 DEFAULT NULL,
    CONSTRAINT webhook_events_pkey PRIMARY KEY (id),
    CONSTRAINT webhook_events_status_check
        CHECK (status IN ('pending', 'processing', 'processed', 'done', 'failed'))
);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_webhook_events_provider_event'
    ) THEN
        ALTER TABLE public.webhook_events
            ADD CONSTRAINT uq_webhook_events_provider_event
            UNIQUE (provider, provider_event_id);
    END IF;
END $$;;
