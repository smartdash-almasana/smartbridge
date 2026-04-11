-- ============================================================================
-- SmartSeller V2 — Bloque 4: Engine Tables + RPC
-- Migration: 20260224_v2_engine_rpc.sql
--
-- NOTE: v2_engine_runs, v2_clinical_signals, v2_health_scores schemas here
-- are intentionally adapted for the RPC contract (store_id denormalized on
-- signals/scores for the SQL function simplicity).
-- If these tables exist from a prior migration, DROP them first or
-- adapt columns with ALTER TABLE before applying this migration.
-- ============================================================================

-- ─── 1. v2_engine_runs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_engine_runs (
  run_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        NOT NULL
    REFERENCES public.v2_stores(store_id) ON DELETE RESTRICT,
  status      text        NOT NULL
    CHECK (status IN ('running', 'done', 'failed')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_v2_engine_runs_store_started
  ON public.v2_engine_runs (store_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_v2_engine_runs_status
  ON public.v2_engine_runs (status, started_at DESC);

-- ─── 2. v2_clinical_signals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_clinical_signals (
  signal_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        NOT NULL
    REFERENCES public.v2_stores(store_id) ON DELETE RESTRICT,
  run_id      uuid        NOT NULL
    REFERENCES public.v2_engine_runs(run_id) ON DELETE RESTRICT,
  signal_key  text        NOT NULL,
  severity    text        NOT NULL
    CHECK (severity IN ('info', 'warning', 'critical')),
  evidence    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v2_clinical_signals_store_run
  ON public.v2_clinical_signals (store_id, run_id);

CREATE INDEX IF NOT EXISTS idx_v2_clinical_signals_signal_key
  ON public.v2_clinical_signals (signal_key);

-- ─── 3. v2_health_scores ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_health_scores (
  score_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        NOT NULL
    REFERENCES public.v2_stores(store_id) ON DELETE RESTRICT,
  run_id      uuid        NOT NULL
    REFERENCES public.v2_engine_runs(run_id) ON DELETE RESTRICT,
  score       numeric     NOT NULL CHECK (score >= 0 AND score <= 100),
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v2_health_scores_store
  ON public.v2_health_scores (store_id, computed_at DESC);

-- ─── 4. RPC: v2_run_engine_for_store ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION v2_run_engine_for_store(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run_id        uuid;
  v_score         numeric;
  v_signal_count  int;
BEGIN
  -- 1. Crear engine run
  INSERT INTO v2_engine_runs (store_id, status, started_at)
  VALUES (p_store_id, 'running', now())
  RETURNING run_id INTO v_run_id;

  -- 2. Contar domain_events recientes (últimas 24h) como señal base
  SELECT COUNT(*) INTO v_signal_count
  FROM v2_domain_events de
  JOIN v2_webhook_events we ON we.event_id = de.source_event_id
  WHERE we.store_id = p_store_id
    AND de.normalized_at >= now() - interval '24 hours';

  -- 3. Insertar signal
  INSERT INTO v2_clinical_signals (store_id, run_id, signal_key, severity, evidence)
  VALUES (
    p_store_id,
    v_run_id,
    'events_last_24h',
    CASE WHEN v_signal_count > 0 THEN 'info' ELSE 'warning' END,
    jsonb_build_object('count', v_signal_count)
  );

  -- 4. Score determinístico minimal (0-100)
  v_score := LEAST(v_signal_count * 10, 100);

  INSERT INTO v2_health_scores (store_id, run_id, score, computed_at)
  VALUES (p_store_id, v_run_id, v_score, now());

  -- 5. Cerrar run
  UPDATE v2_engine_runs
  SET status = 'done', finished_at = now()
  WHERE run_id = v_run_id;

  RETURN jsonb_build_object(
    'run_id',   v_run_id,
    'score',    v_score,
    'signals',  v_signal_count
  );

EXCEPTION WHEN OTHERS THEN
  UPDATE v2_engine_runs
  SET status = 'failed', finished_at = now()
  WHERE run_id = v_run_id;
  RAISE;
END;
$$;
