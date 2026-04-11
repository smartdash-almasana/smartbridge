-- ─────────────────────────────────────────────────────────────────────────────
-- V2 Ingest Orchestrator Cron (flujo normal)
-- Migration: 20260308_v2_ingest_orchestrator_cron.sql
-- Objetivo: reactivar invocación periódica del worker HTTP normal
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_ingest_orchestrator()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id bigint;
  v_response jsonb;
  v_cron_secret text;
BEGIN
  v_cron_secret := nullif(current_setting('app.settings.cron_secret', true), '');
  IF v_cron_secret IS NULL THEN
    RAISE EXCEPTION 'Missing app.settings.cron_secret for ingest orchestrator cron';
  END IF;

  SELECT net.http_get(
    url := 'https://smartsellerv2.vercel.app/api/worker/v2-webhook-to-domain?limit=50',
    headers := jsonb_build_object(
      'x-cron-secret', v_cron_secret
    )
  )
  INTO v_request_id;

  v_response := jsonb_build_object(
    'request_id', v_request_id,
    'worker', 'v2-webhook-to-domain',
    'mode', 'normal'
  );

  BEGIN
    INSERT INTO public.v2_cron_runs (job_name, status, pg_net_request_id, response)
    VALUES ('ingest_orchestrator_2m', 'ok', v_request_id, v_response);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.v2_cron_runs (job_name, status, error_message, response)
    VALUES (
      'ingest_orchestrator_2m',
      'error',
      SQLERRM,
      jsonb_build_object(
        'worker', 'v2-webhook-to-domain',
        'mode', 'normal'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'worker', 'v2-webhook-to-domain',
    'mode', 'normal',
    'error', SQLERRM
  );
END;
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'ingest_orchestrator_2m'
  ORDER BY jobid DESC
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'ingest_orchestrator_2m',
  '*/2 * * * *',
  $$SELECT public.run_ingest_orchestrator();$$
);
