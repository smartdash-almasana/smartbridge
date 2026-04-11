-- ============================================================================
-- Migration: v2_ingest_attempts
-- ADR: ADR-0005-ingest-observability.md
-- Date: 2026-03-03
-- Descripción:
--   Tabla append-only de auditoría de intentos de normalización de webhooks
--   a domain events. Cada intento (ok | error | skipped) genera 1 fila.
--   No modifica tablas existentes.
-- NO APLICAR sin leer ADR-0005 y ejecutar el rollout ordenado.
-- ============================================================================

-- ─── Tabla principal ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.v2_ingest_attempts (
    attempt_id      uuid            NOT NULL DEFAULT gen_random_uuid(),
    event_id        uuid            NULL,           -- FK suave: nullable para sobrevivir a DELETE en webhook_events
    store_id        uuid            NOT NULL,       -- desnormalizado para queries directas sin JOIN
    worker          text            NOT NULL,       -- 'v2-webhook-to-domain' | 'normalizer' | 'meli-sync'
    status          text            NOT NULL,       -- 'ok' | 'error' | 'skipped'
    error_message   text            NULL,           -- mensaje corto del error
    error_detail    jsonb           NULL,           -- stack trace, contexto, input state
    created_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT v2_ingest_attempts_pkey
        PRIMARY KEY (attempt_id),

    CONSTRAINT v2_ingest_attempts_event_id_fk
        FOREIGN KEY (event_id)
        REFERENCES public.v2_webhook_events (event_id)
        ON DELETE SET NULL,                        -- FK suave: auditoría sobrevive a cleanup de webhooks

    CONSTRAINT v2_ingest_attempts_status_check
        CHECK (status IN ('ok', 'error', 'skipped')),

    CONSTRAINT v2_ingest_attempts_worker_notempty
        CHECK (worker <> '')
);

COMMENT ON TABLE public.v2_ingest_attempts IS
    'Auditoría append-only de intentos de normalización webhook→domain. '
    'Ver ADR-0005-ingest-observability.md';

COMMENT ON COLUMN public.v2_ingest_attempts.worker IS
    'Identificador del worker: v2-webhook-to-domain | normalizer | meli-sync';

COMMENT ON COLUMN public.v2_ingest_attempts.status IS
    'ok = domain_event creado; error = falló; skipped = ya existía (deduped)';

COMMENT ON COLUMN public.v2_ingest_attempts.error_detail IS
    'JSON libre: stack trace, contexto del input state, código de error de Postgres, etc.';

-- ─── Índices ──────────────────────────────────────────────────────────────────

-- Diagnóstico operativo: ultimos errores/skips de un store
CREATE INDEX idx_v2_ingest_attempts_store_created
    ON public.v2_ingest_attempts (store_id, created_at DESC);

-- DLQ: eventos atascados (error sin domain_event correspondiente)
CREATE INDEX idx_v2_ingest_attempts_event_status
    ON public.v2_ingest_attempts (event_id, status)
    WHERE event_id IS NOT NULL;

-- Monitoreo por worker y status
CREATE INDEX idx_v2_ingest_attempts_worker_status
    ON public.v2_ingest_attempts (worker, status, created_at DESC);


-- ============================================================================
-- 2 QUERIES DE MONITOREO (para referencia, no ejecutar como parte de migration)
-- ============================================================================

-- Q1: Últimos errores de ingest para un store específico
-- (reemplazar '<STORE_ID>' con uuid real)

/*
SELECT
    ia.store_id,
    ia.worker,
    ia.status,
    ia.error_message,
    ia.error_detail,
    ia.created_at,
    we.provider_event_id,
    we.topic,
    we.resource
FROM public.v2_ingest_attempts ia
LEFT JOIN public.v2_webhook_events we ON we.event_id = ia.event_id
WHERE ia.store_id = '<STORE_ID>'
  AND ia.status = 'error'
ORDER BY ia.created_at DESC
LIMIT 20;
*/


-- Q2: Eventos atascados — error pero sin domain_event (DLQ lógica)

/*
SELECT
    ia.event_id,
    ia.store_id,
    ia.worker,
    ia.error_message,
    COUNT(*)                AS attempts,
    MAX(ia.created_at)      AS last_attempt_at
FROM public.v2_ingest_attempts ia
WHERE ia.status = 'error'
  AND NOT EXISTS (
      SELECT 1 FROM public.v2_domain_events de
      WHERE de.source_event_id = ia.event_id
  )
GROUP BY ia.event_id, ia.store_id, ia.worker, ia.error_message
ORDER BY last_attempt_at DESC
LIMIT 50;
*/
