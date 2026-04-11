-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2.B0 — Typed Writer DLQ / Fallback Table
-- Migration: 20260303_13_phase2b0_typed_writer_dlq.sql
-- Objetivo: Cerrar W0 GAP con la tabla v2_dlq_events mínima y clínica.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.v2_dlq_events (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Identidad Clínica (multi-tenant safe)
  tenant_id      uuid NOT NULL,
  store_id       uuid NOT NULL,
  seller_uuid    uuid,
  provider_key   text NOT NULL,
  
  -- Contexto del error
  source         text NOT NULL,
  event_type     text NOT NULL,
  external_id    text,
  
  -- Evidencia y deduplicación
  dedupe_key     text NOT NULL UNIQUE,
  raw_event      jsonb NOT NULL,
  
  -- Detalles del fallo
  error_code     text NOT NULL,
  error_detail   text NOT NULL,
  
  -- Operabilidad / Reintentos
  attempt_count  int NOT NULL DEFAULT 0,
  next_retry_at  timestamptz,
  status         text NOT NULL DEFAULT 'open' 
                 CHECK (status IN ('open', 'retrying', 'resolved', 'ignored')),
  
  -- Auditoría
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT fk_v2_dlq_events_store 
    FOREIGN KEY (tenant_id, store_id) 
    REFERENCES public.v2_stores(tenant_id, store_id) 
    ON DELETE RESTRICT
);

-- Índices recomendados
CREATE INDEX IF NOT EXISTS idx_v2_dlq_events_tenant_store_status 
  ON public.v2_dlq_events (tenant_id, store_id, status);

CREATE INDEX IF NOT EXISTS idx_v2_dlq_events_provider_type 
  ON public.v2_dlq_events (provider_key, event_type);

CREATE INDEX IF NOT EXISTS idx_v2_dlq_events_next_retry 
  ON public.v2_dlq_events (next_retry_at) 
  WHERE status IN ('open', 'retrying');

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_v2_dlq_events_set_updated_at ON public.v2_dlq_events;
CREATE TRIGGER trg_v2_dlq_events_set_updated_at
  BEFORE UPDATE ON public.v2_dlq_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
