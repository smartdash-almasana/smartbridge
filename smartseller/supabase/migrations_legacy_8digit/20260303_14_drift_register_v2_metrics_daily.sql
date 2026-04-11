-- ─────────────────────────────────────────────────────────────────────────────
-- Drift Patch — Clinical Pipeline Synchronization
-- Migration: 20260303_14_drift_register_v2_metrics_daily.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Register v2_metrics_daily (Compassion/Registry mode)
-- Reflecting actual DDL found in Supabase
CREATE TABLE IF NOT EXISTS public.v2_metrics_daily (
  tenant_id    uuid    NOT NULL,
  store_id     uuid    NOT NULL,
  metric_date  date    NOT NULL,
  metrics      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, store_id, metric_date)
);

-- Ensure indexes for clinical window queries
CREATE INDEX IF NOT EXISTS idx_v2_metrics_daily_store_date
  ON public.v2_metrics_daily (store_id, metric_date DESC);

-- 2. v2_engine_runs: Add tenant_id for multi-tenant enforcement
-- Step 2a: Add column as nullable first
ALTER TABLE public.v2_engine_runs 
ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.v2_tenants(tenant_id);

-- Step 2b: Backfill tenant_id from stores
UPDATE public.v2_engine_runs r
SET tenant_id = s.tenant_id
FROM public.v2_stores s
WHERE r.store_id = s.store_id
  AND r.tenant_id IS NULL;

-- Step 2c: Enforce NOT NULL
-- Using standard enforcement after backfill verification
ALTER TABLE public.v2_engine_runs ALTER COLUMN tenant_id SET NOT NULL;

-- Step 2d: Composite FK for store identity safety
ALTER TABLE public.v2_engine_runs
ADD CONSTRAINT v2_engine_runs_store_identity_fk
FOREIGN KEY (tenant_id, store_id)
REFERENCES public.v2_stores (tenant_id, store_id)
ON DELETE RESTRICT;

-- Index for multi-tenant lookup
CREATE INDEX IF NOT EXISTS idx_v2_engine_runs_tenant_store
  ON public.v2_engine_runs (tenant_id, store_id);

COMMIT;
