-- SmartSeller V2 — Legacy engine RPC traceability hardening
-- Goal: prevent new v2_clinical_signals rows without tenant_id/snapshot_id.

BEGIN;

CREATE OR REPLACE FUNCTION public.v2_run_engine_for_store(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run_id        uuid;
  v_snapshot_id   uuid;
  v_tenant_id     uuid;
  v_score         numeric;
  v_signal_count  int;
BEGIN
  -- Resolve tenant identity from store.
  SELECT s.tenant_id
    INTO v_tenant_id
  FROM public.v2_stores s
  WHERE s.store_id = p_store_id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'v2_run_engine_for_store: tenant not found for store_id=%', p_store_id;
  END IF;

  -- 1) Create engine run with full identity.
  INSERT INTO public.v2_engine_runs (tenant_id, store_id, status, started_at)
  VALUES (v_tenant_id, p_store_id, 'running', now())
  RETURNING run_id INTO v_run_id;

  -- 2) Seed snapshot for run-level traceability.
  INSERT INTO public.v2_snapshots (tenant_id, store_id, run_id, snapshot_at, payload)
  VALUES (
    v_tenant_id,
    p_store_id,
    v_run_id,
    now(),
    jsonb_build_object(
      'source', 'v2_run_engine_for_store',
      'metric_date', (now() at time zone 'utc')::date
    )
  )
  RETURNING snapshot_id INTO v_snapshot_id;

  -- 3) Count recent domain events as legacy signal input.
  SELECT COUNT(*) INTO v_signal_count
  FROM public.v2_domain_events de
  JOIN public.v2_webhook_events we ON we.event_id = de.source_event_id
  WHERE we.store_id = p_store_id
    AND de.normalized_at >= now() - interval '24 hours';

  -- 4) Insert fully linked signal row.
  INSERT INTO public.v2_clinical_signals (
    tenant_id, store_id, run_id, snapshot_id, signal_key, severity, evidence
  )
  VALUES (
    v_tenant_id,
    p_store_id,
    v_run_id,
    v_snapshot_id,
    'events_last_24h',
    CASE WHEN v_signal_count > 0 THEN 'info' ELSE 'warning' END,
    jsonb_build_object('count', v_signal_count)
  );

  -- 5) Persist score with full identity linkage.
  v_score := LEAST(v_signal_count * 10, 100);

  INSERT INTO public.v2_health_scores (
    tenant_id, store_id, run_id, snapshot_id, score, computed_at
  )
  VALUES (
    v_tenant_id, p_store_id, v_run_id, v_snapshot_id, v_score, now()
  );

  -- 6) Close run.
  UPDATE public.v2_engine_runs
  SET status = 'done', finished_at = now()
  WHERE run_id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'score', v_score,
    'signals', v_signal_count,
    'snapshot_id', v_snapshot_id
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.v2_engine_runs
  SET status = 'failed', finished_at = now()
  WHERE run_id = v_run_id;
  RAISE;
END;
$$;

COMMIT;
