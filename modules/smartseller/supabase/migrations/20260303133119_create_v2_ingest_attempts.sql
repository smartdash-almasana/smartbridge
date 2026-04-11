-- ============================================================================
-- Migration: v2_ingest_attempts
-- ADR: ADR-0005-ingest-observability.md
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.v2_ingest_attempts (
    attempt_id      uuid            NOT NULL DEFAULT gen_random_uuid(),
    event_id        uuid            NULL,
    store_id        uuid            NOT NULL,
    worker          text            NOT NULL,
    status          text            NOT NULL,
    error_message   text            NULL,
    error_detail    jsonb           NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT v2_ingest_attempts_pkey
        PRIMARY KEY (attempt_id),

    CONSTRAINT v2_ingest_attempts_event_id_fk
        FOREIGN KEY (event_id)
        REFERENCES public.v2_webhook_events (event_id)
        ON DELETE SET NULL,

    CONSTRAINT v2_ingest_attempts_status_check
        CHECK (status IN ('ok', 'error', 'skipped')),

    CONSTRAINT v2_ingest_attempts_worker_notempty
        CHECK (worker <> '')
);

COMMENT ON TABLE public.v2_ingest_attempts IS
    'Auditoría append-only de intentos de normalización webhook→domain. Ver ADR-0005-ingest-observability.md';

COMMENT ON COLUMN public.v2_ingest_attempts.worker IS
    'Identificador del worker: v2-webhook-to-domain | normalizer | meli-sync';

COMMENT ON COLUMN public.v2_ingest_attempts.status IS
    'ok = domain_event creado; error = falló; skipped = ya existía (deduped)';

COMMENT ON COLUMN public.v2_ingest_attempts.error_detail IS
    'JSON libre: stack trace, contexto del input state, código de error de Postgres, etc.';

CREATE INDEX idx_v2_ingest_attempts_store_created
    ON public.v2_ingest_attempts (store_id, created_at DESC);

CREATE INDEX idx_v2_ingest_attempts_event_status
    ON public.v2_ingest_attempts (event_id, status)
    WHERE event_id IS NOT NULL;

CREATE INDEX idx_v2_ingest_attempts_worker_status
    ON public.v2_ingest_attempts (worker, status, created_at DESC);;
