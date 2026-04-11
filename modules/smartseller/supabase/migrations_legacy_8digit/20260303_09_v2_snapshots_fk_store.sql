-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.A — FK compuesta v2_snapshots → v2_stores
-- Migration: 20260303_09_v2_snapshots_fk_store.sql
--
-- Pre-conditions verificadas antes de aplicar:
--   1. v2_stores.tenant_id NOT NULL, v2_stores.store_id NOT NULL ✅
--   2. v2_snapshots.tenant_id y .store_id presentes ✅
--   3. orphan_snapshots = 0 (LEFT JOIN check = 0 filas huérfanas) ✅
--
-- Estrategia sin downtime:
--   - CREATE UNIQUE INDEX CONCURRENTLY no disponible en función transaccional
--     pero IF NOT EXISTS es seguro en Supabase (DDL atómico).
--   - FK creada con NOT VALID + VALIDATE separado para evitar lockeo prolongado.
-- ─────────────────────────────────────────────────────────────────────────────

-- Paso 1: UNIQUE(tenant_id, store_id) en v2_stores como target de la FK compuesta.
-- La PK cubre solo store_id; una FK compuesta requiere un UNIQUE en las columnas referenciadas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_stores_tenant_store
  ON public.v2_stores (tenant_id, store_id);

-- Paso 2: Índice de soporte en v2_snapshots para lookup eficiente vía FK.
CREATE INDEX IF NOT EXISTS idx_v2_snapshots_tenant_store
  ON public.v2_snapshots (tenant_id, store_id);

-- Paso 3: FK compuesta NOT VALID (sin scan completo = sin lockeo prolongado en tabla existente).
ALTER TABLE public.v2_snapshots
  ADD CONSTRAINT fk_v2_snapshots_store
  FOREIGN KEY (tenant_id, store_id)
  REFERENCES public.v2_stores (tenant_id, store_id)
  ON DELETE RESTRICT
  NOT VALID;

-- Paso 4: Validar constraint (verifica integridad de todas las filas existentes).
-- En Postgres esto no lockea escrituras, solo lecturas de v2_stores.
ALTER TABLE public.v2_snapshots
  VALIDATE CONSTRAINT fk_v2_snapshots_store;
