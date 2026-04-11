BEGIN;

ALTER TABLE public.v2_health_scores
  ADD COLUMN IF NOT EXISTS snapshot_id uuid;

ALTER TABLE public.v2_health_scores
  ADD COLUMN IF NOT EXISTS run_id uuid;

ALTER TABLE public.v2_clinical_signals
  ADD COLUMN IF NOT EXISTS snapshot_id uuid;

ALTER TABLE public.v2_clinical_signals
  ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE INDEX IF NOT EXISTS idx_v2_health_scores_store_run
  ON public.v2_health_scores(store_id, run_id);

CREATE INDEX IF NOT EXISTS idx_v2_clinical_signals_store_run
  ON public.v2_clinical_signals(store_id, run_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_health_scores_store_run
  ON public.v2_health_scores(store_id, run_id);

COMMIT;
