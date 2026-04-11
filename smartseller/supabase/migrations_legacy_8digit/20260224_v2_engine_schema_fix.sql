-- ============================================================================
-- Corrective migration: align engine tables to Bloque 4 contract
-- Safe: tables are V2-only, no V1 dependency, demo data expendable
-- ============================================================================

BEGIN;

-- Drop in reverse FK order
DROP TABLE IF EXISTS public.v2_health_scores CASCADE;
DROP TABLE IF EXISTS public.v2_clinical_signals CASCADE;
DROP TABLE IF EXISTS public.v2_engine_runs CASCADE;

-- Recreate con schema correcto
CREATE TABLE public.v2_engine_runs (
  run_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES public.v2_stores(store_id) ON DELETE RESTRICT,
  status      text NOT NULL CHECK (status IN ('running','done','failed')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.v2_clinical_signals (
  signal_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES public.v2_stores(store_id) ON DELETE RESTRICT,
  run_id      uuid NOT NULL REFERENCES public.v2_engine_runs(run_id) ON DELETE RESTRICT,
  signal_key  text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('info','warning','critical')),
  evidence    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.v2_health_scores (
  score_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES public.v2_stores(store_id) ON DELETE RESTRICT,
  run_id      uuid NOT NULL REFERENCES public.v2_engine_runs(run_id) ON DELETE RESTRICT,
  score       numeric NOT NULL CHECK (score >= 0 AND score <= 100),
  computed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
