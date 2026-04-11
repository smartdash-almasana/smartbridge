-- Phase 1.A — FK compuesta v2_snapshots(tenant_id, store_id) → v2_stores(tenant_id, store_id)
-- Pre-conditions verificadas (orphan_snapshots = 0).

-- Paso 1: UNIQUE(tenant_id, store_id) en v2_stores como target de la FK compuesta
-- (la PK cubre solo store_id; la FK compuesta requiere un UNIQUE en la tabla referenciada)
CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_stores_tenant_store
  ON public.v2_stores (tenant_id, store_id);

-- Paso 2: Índice de soporte en v2_snapshots para lookup eficiente
CREATE INDEX IF NOT EXISTS idx_v2_snapshots_tenant_store
  ON public.v2_snapshots (tenant_id, store_id);

-- Paso 3: FK compuesta con NOT VALID (sin scan completo = sin lockeo prolongado)
ALTER TABLE public.v2_snapshots
  ADD CONSTRAINT fk_v2_snapshots_store
  FOREIGN KEY (tenant_id, store_id)
  REFERENCES public.v2_stores (tenant_id, store_id)
  ON DELETE RESTRICT
  NOT VALID;

-- Paso 4: Validar constraint (verifica todas las filas en background, sin lockeo en escritura)
ALTER TABLE public.v2_snapshots
  VALIDATE CONSTRAINT fk_v2_snapshots_store;;
