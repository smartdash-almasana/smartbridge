-- ============================================================================
-- SmartSeller — DDL V2 Run Boundary (Fase C)
-- Migration:  20260224_v2_run_boundary
-- Canon:      ADR-004-v3, ADR-005-v1
-- ============================================================================

-- ─── 1. public.v2_engine_runs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_engine_runs (
  run_id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid        NOT NULL
    REFERENCES public.v2_stores (store_id) ON DELETE RESTRICT,
  adapter_version   text        NOT NULL,
  rulepack_version  text        NOT NULL,
  engine_version    text        NOT NULL,
  triggered_by      text        NOT NULL
    CONSTRAINT v2_engine_runs_triggered_by_check
      CHECK (triggered_by IN ('webhook', 'cron', 'manual', 'backfill')),
  status            text        NOT NULL DEFAULT 'running'
    CONSTRAINT v2_engine_runs_status_check
      CHECK (status IN ('running', 'completed', 'failed')),
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz NULL,
  CONSTRAINT v2_engine_runs_temporal_check
    CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_v2_engine_runs_store_started
  ON public.v2_engine_runs (store_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_v2_engine_runs_status_started
  ON public.v2_engine_runs (status, started_at DESC);

-- ─── 2. public.v2_state_snapshots ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_state_snapshots (
  snapshot_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid        NOT NULL
    REFERENCES public.v2_engine_runs (run_id) ON DELETE RESTRICT,
  snapshot_type text        NOT NULL,
  payload       jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_state_snapshots_run_type
    UNIQUE (run_id, snapshot_type)
);

CREATE INDEX IF NOT EXISTS idx_v2_state_snapshots_run_id
  ON public.v2_state_snapshots (run_id);

-- ─── 3. public.v2_clinical_signals ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_clinical_signals (
  signal_id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               uuid        NOT NULL
    REFERENCES public.v2_engine_runs (run_id) ON DELETE RESTRICT,
  signal_key           text        NOT NULL,
  severity             text        NOT NULL
    CONSTRAINT v2_clinical_signals_severity_check
      CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  evidence             jsonb       NOT NULL,
  is_active            boolean     NOT NULL DEFAULT true,
  superseded_by_run_id uuid        NULL
    REFERENCES public.v2_engine_runs (run_id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_clinical_signals_run_key
    UNIQUE (run_id, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_v2_clinical_signals_run_id
  ON public.v2_clinical_signals (run_id);

CREATE INDEX IF NOT EXISTS idx_v2_clinical_signals_signal_key
  ON public.v2_clinical_signals (signal_key);

CREATE INDEX IF NOT EXISTS idx_v2_clinical_signals_is_active
  ON public.v2_clinical_signals (is_active);

-- ─── 4. public.v2_health_scores ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_health_scores (
  score_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid        NOT NULL UNIQUE
    REFERENCES public.v2_engine_runs (run_id) ON DELETE RESTRICT,
  score_total   numeric     NOT NULL,
  band          text        NOT NULL
    CONSTRAINT v2_health_scores_band_check
      CHECK (band IN ('healthy', 'watch', 'risk', 'critical')),
  breakdown     jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);;
