CREATE TABLE IF NOT EXISTS public.v2_cron_runs (
    cron_run_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    job_name text NOT NULL,
    status text NOT NULL CHECK (status IN ('ok','error')),
    pg_net_request_id bigint NULL,
    response jsonb NULL,
    error_message text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v2_cron_runs_job_name_created 
    ON public.v2_cron_runs (job_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_cron_runs_status_created 
    ON public.v2_cron_runs (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.run_dlq_reprocessor()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  req_id bigint;
  res jsonb;
  v_error_msg text;
BEGIN
  -- Hacer request GET al worker DLQ usando pg_net
  SELECT net.http_get(
    url := 'https://smartsellerv2.vercel.app/api/worker/v2-webhook-to-domain?mode=dlq&limit=50',
    headers := '{"x-cron-secret": "dev-123-57"}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO req_id;
  
  res := jsonb_build_object(
    'ok', true,
    'requested_at', now(),
    'pg_net_request_id', req_id
  );
  
  -- Best effort logging
  BEGIN
      INSERT INTO public.v2_cron_runs (job_name, status, pg_net_request_id, response)
      VALUES ('dlq_reprocessor_10m', 'ok', req_id, res);
  EXCEPTION WHEN OTHERS THEN
      -- Ignorar fallo en el log para no romper cron
  END;

  RETURN res;
EXCEPTION WHEN OTHERS THEN
  v_error_msg := SQLERRM;
  
  res := jsonb_build_object(
    'ok', false,
    'error', v_error_msg
  );
  
  -- Best effort error logging
  BEGIN
      INSERT INTO public.v2_cron_runs (job_name, status, error_message, response)
      VALUES ('dlq_reprocessor_10m', 'error', v_error_msg, res);
  EXCEPTION WHEN OTHERS THEN
      -- Ignorar fallo en el log
  END;
  
  RETURN res;
END;
$$;;
