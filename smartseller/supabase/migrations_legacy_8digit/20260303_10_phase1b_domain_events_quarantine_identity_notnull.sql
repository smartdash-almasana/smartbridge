-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.B — Quarantine + enforcement de identidad en v2_domain_events
-- Migration: 20260303_10_phase1b_domain_events_quarantine_identity_notnull.sql
--
-- Pre-conditions verificadas antes de aplicar:
--   - null_store_id  = 0 (store_id ya estaba bien)
--   - null_tenant_id = 5 (tenant_id NULL en 5 filas con store_id = 0485e5e6)
--   - any_null_identity = 5 (exactamente las esperadas)
--   - Las 5 filas tienen store_id válido; el worker de ingest no propagaba tenant_id
--
-- Resultado:
--   - 5 filas movidas a v2_domain_events_quarantine ✅
--   - v2_domain_events.store_id  → NOT NULL ✅
--   - v2_domain_events.tenant_id → NOT NULL ✅
--   - QA Gate B1B2 → PASS ✅
-- ─────────────────────────────────────────────────────────────────────────────

-- Paso 1: Tabla de cuarentena (sin constraints — recibe datos sucios tal cual)
CREATE TABLE IF NOT EXISTS public.v2_domain_events_quarantine (
  domain_event_id   uuid,
  source_event_id   uuid,
  event_type        text,
  entity_type       text,
  entity_id         text,
  payload           jsonb,
  occurred_at       timestamptz,
  normalized_at     timestamptz,
  tenant_id         uuid,
  store_id          uuid,
  quarantine_reason text NOT NULL,
  quarantined_at    timestamptz NOT NULL DEFAULT now()
);

-- Paso 2: Mover exactamente las filas con NULL identity en una sola operación atómica
WITH moved AS (
  DELETE FROM public.v2_domain_events
  WHERE store_id IS NULL OR tenant_id IS NULL
  RETURNING *
)
INSERT INTO public.v2_domain_events_quarantine (
  domain_event_id, source_event_id, event_type, entity_type, entity_id,
  payload, occurred_at, normalized_at, tenant_id, store_id,
  quarantine_reason, quarantined_at
)
SELECT
  domain_event_id, source_event_id, event_type, entity_type, entity_id,
  payload, occurred_at, normalized_at, tenant_id, store_id,
  'NULL_IDENTITY: store_id=' || COALESCE(store_id::text, 'NULL') ||
  ' tenant_id=' || COALESCE(tenant_id::text, 'NULL'),
  now()
FROM moved;

-- Paso 3: CHECK NOT VALID (no lockea escrituras en curso)
ALTER TABLE public.v2_domain_events
  ADD CONSTRAINT de_store_id_nn
  CHECK (store_id IS NOT NULL) NOT VALID;

ALTER TABLE public.v2_domain_events
  ADD CONSTRAINT de_tenant_id_nn
  CHECK (tenant_id IS NOT NULL) NOT VALID;

-- Paso 4: Validar (verifica todas las filas existentes sin lock en escritura)
ALTER TABLE public.v2_domain_events VALIDATE CONSTRAINT de_store_id_nn;
ALTER TABLE public.v2_domain_events VALIDATE CONSTRAINT de_tenant_id_nn;

-- Paso 5: Promover a NOT NULL real
ALTER TABLE public.v2_domain_events ALTER COLUMN store_id  SET NOT NULL;
ALTER TABLE public.v2_domain_events ALTER COLUMN tenant_id SET NOT NULL;

-- Paso 6: Los CHECK son redundantes una vez aplicado NOT NULL — limpiar
ALTER TABLE public.v2_domain_events DROP CONSTRAINT IF EXISTS de_store_id_nn;
ALTER TABLE public.v2_domain_events DROP CONSTRAINT IF EXISTS de_tenant_id_nn;
