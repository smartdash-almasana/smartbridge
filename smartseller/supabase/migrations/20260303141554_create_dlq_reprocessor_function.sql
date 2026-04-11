CREATE OR REPLACE FUNCTION public.run_dlq_reprocessor()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  req_id bigint;
  res jsonb;
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
  
  RETURN res;
END;
$$;;
