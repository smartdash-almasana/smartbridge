-- SmartSeller V2 — Atomic merge writer for v2_metrics_daily
-- Fix: prevent destructive overwrite under concurrent/overlapping worker writes.

BEGIN;

CREATE OR REPLACE FUNCTION public.v2_upsert_metrics_daily_merge(
  p_tenant_id uuid,
  p_store_id uuid,
  p_metric_date date,
  p_metrics_patch jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.v2_metrics_daily (
    tenant_id,
    store_id,
    metric_date,
    metrics
  )
  VALUES (
    p_tenant_id,
    p_store_id,
    p_metric_date,
    COALESCE(p_metrics_patch, '{}'::jsonb)
  )
  ON CONFLICT (tenant_id, store_id, metric_date)
  DO UPDATE
  SET metrics = COALESCE(public.v2_metrics_daily.metrics, '{}'::jsonb)
                || COALESCE(EXCLUDED.metrics, '{}'::jsonb);
END;
$$;

COMMIT;
