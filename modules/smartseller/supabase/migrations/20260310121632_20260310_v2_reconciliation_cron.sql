-- ─────────────────────────────────────────────────────────────────────────────
-- V2 Reconciliation Operational Activation
-- Migration: 20260310_v2_reconciliation_cron.sql
-- Objetivo: activar enqueue RPC + cron operativa para worker meli-reconcile
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.v2_enqueue_reconciliation_jobs(p_scope text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_inserted integer := 0;
BEGIN
  v_scope := COALESCE(NULLIF(trim(p_scope), ''), 'orders');

  IF v_scope <> 'orders' THEN
    RAISE EXCEPTION 'Unsupported reconciliation scope: %', v_scope;
  END IF;

  WITH active_meli_stores AS (
    SELECT s.store_id
    FROM public.v2_stores s
    WHERE s.provider_key = 'mercadolibre'
      AND EXISTS (
        SELECT 1
        FROM public.v2_oauth_tokens t
        WHERE t.store_id = s.store_id
           AND t.status = 'active'
      )
  ),
  inserted AS (
    INSERT INTO public.v2_reconciliation_jobs (
      store_id,
      scope,
      status,
      attempts,
      next_eligible_at,
      created_at,
      updated_at
    )
    SELECT
      ms.store_id,
      v_scope,
      'pending',
      0,
      now(),
      now(),
      now()
    FROM active_meli_stores ms
    ON CONFLICT (store_id, scope) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO v_inserted
  FROM inserted;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_meli_reconcile()
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
    RAISE EXCEPTION 'Missing app.settings.cron_secret for meli reconcile cron';
  END IF;

  SELECT net.http_get(
    url := 'https://smartsellerv2.vercel.app/api/worker/meli-reconcile?scope=orders&limit=50',
    headers := jsonb_build_object(
      'x-cron-secret', v_cron_secret
    )
  )
  INTO v_request_id;

  v_response := jsonb_build_object(
    'request_id', v_request_id,
    'worker', 'meli-reconcile',
    'scope', 'orders'
  );

  BEGIN
    INSERT INTO public.v2_cron_runs (job_name, status, pg_net_request_id, response)
    VALUES ('meli_reconcile_6h', 'ok', v_request_id, v_response);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.v2_cron_runs (job_name, status, error_message, response)
    VALUES (
      'meli_reconcile_6h',
      'error',
      SQLERRM,
      jsonb_build_object(
        'worker', 'meli-reconcile',
        'scope', 'orders'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'worker', 'meli-reconcile',
    'scope', 'orders',
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
  WHERE jobname = 'meli_reconcile_6h'
  ORDER BY jobid DESC
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'meli_reconcile_6h',
  '0 */6 * * *',
  $$SELECT public.run_meli_reconcile();$$
);;
