-- SmartSeller V3 — Domain events to snapshots worker support
-- Scope:
--   1) Internal snapshot job queue keyed by (tenant_id, store_id, metric_date)
--   2) Enqueue RPC from v3_domain_events candidates
--   3) Concurrency-safe claim RPC with lease recovery

BEGIN;

CREATE TABLE IF NOT EXISTS public.v3_snapshot_jobs (
  job_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  store_id                  uuid NOT NULL,
  metric_date               date NOT NULL,
  last_source_normalized_at timestamptz NOT NULL,
  processing_status         text NOT NULL DEFAULT 'pending'
                            CHECK (processing_status IN ('pending', 'processing', 'processed', 'error')),
  claimed_at                timestamptz,
  processed_at              timestamptz,
  processing_error          text,
  run_id                    uuid,
  snapshot_id               uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, metric_date),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES public.v3_stores (tenant_id, store_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_snapshot_jobs_status_claimed
  ON public.v3_snapshot_jobs (processing_status, claimed_at, last_source_normalized_at);

DROP TRIGGER IF EXISTS trg_v3_snapshot_jobs_set_updated_at ON public.v3_snapshot_jobs;
CREATE TRIGGER trg_v3_snapshot_jobs_set_updated_at
BEFORE UPDATE ON public.v3_snapshot_jobs
FOR EACH ROW EXECUTE FUNCTION public.v3_set_updated_at();

DROP FUNCTION IF EXISTS public.v3_enqueue_snapshot_jobs(integer);
CREATE OR REPLACE FUNCTION public.v3_enqueue_snapshot_jobs(p_lookback_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH candidate AS (
    SELECT
      de.tenant_id,
      de.store_id,
      (de.occurred_at AT TIME ZONE 'UTC')::date AS metric_date,
      max(de.normalized_at) AS last_source_normalized_at
    FROM public.v3_domain_events de
    WHERE de.occurred_at >= now() - make_interval(days => GREATEST(COALESCE(p_lookback_days, 30), 1))
    GROUP BY de.tenant_id, de.store_id, (de.occurred_at AT TIME ZONE 'UTC')::date
  ),
  upserted AS (
    INSERT INTO public.v3_snapshot_jobs (
      tenant_id, store_id, metric_date, last_source_normalized_at, processing_status
    )
    SELECT
      c.tenant_id,
      c.store_id,
      c.metric_date,
      c.last_source_normalized_at,
      'pending'
    FROM candidate c
    ON CONFLICT (tenant_id, store_id, metric_date)
    DO UPDATE SET
      last_source_normalized_at = GREATEST(
        public.v3_snapshot_jobs.last_source_normalized_at,
        EXCLUDED.last_source_normalized_at
      ),
      processing_status = CASE
        WHEN EXCLUDED.last_source_normalized_at > public.v3_snapshot_jobs.last_source_normalized_at
          THEN 'pending'
        ELSE public.v3_snapshot_jobs.processing_status
      END,
      processing_error = CASE
        WHEN EXCLUDED.last_source_normalized_at > public.v3_snapshot_jobs.last_source_normalized_at
          THEN NULL
        ELSE public.v3_snapshot_jobs.processing_error
      END,
      claimed_at = CASE
        WHEN EXCLUDED.last_source_normalized_at > public.v3_snapshot_jobs.last_source_normalized_at
          THEN NULL
        ELSE public.v3_snapshot_jobs.claimed_at
      END,
      processed_at = CASE
        WHEN EXCLUDED.last_source_normalized_at > public.v3_snapshot_jobs.last_source_normalized_at
          THEN NULL
        ELSE public.v3_snapshot_jobs.processed_at
      END,
      run_id = CASE
        WHEN EXCLUDED.last_source_normalized_at > public.v3_snapshot_jobs.last_source_normalized_at
          THEN NULL
        ELSE public.v3_snapshot_jobs.run_id
      END,
      snapshot_id = CASE
        WHEN EXCLUDED.last_source_normalized_at > public.v3_snapshot_jobs.last_source_normalized_at
          THEN NULL
        ELSE public.v3_snapshot_jobs.snapshot_id
      END
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upserted;

  RETURN v_rows;
END;
$$;

DROP FUNCTION IF EXISTS public.v3_claim_snapshot_jobs(integer, integer);
DROP FUNCTION IF EXISTS public.v3_claim_snapshot_jobs(integer);
CREATE OR REPLACE FUNCTION public.v3_claim_snapshot_jobs(
  p_limit integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  job_id uuid,
  tenant_id uuid,
  store_id uuid,
  metric_date date,
  last_source_normalized_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT j.job_id
    FROM public.v3_snapshot_jobs j
    WHERE j.processing_status = 'pending'
       OR (
         j.processing_status = 'processing'
         AND COALESCE(j.claimed_at, j.updated_at, j.created_at) <= now() - make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 300), 30))
       )
    ORDER BY j.last_source_normalized_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  ),
  claimed AS (
    UPDATE public.v3_snapshot_jobs j
    SET processing_status = 'processing',
        claimed_at = now(),
        processing_error = NULL
    FROM candidate c
    WHERE j.job_id = c.job_id
    RETURNING j.job_id, j.tenant_id, j.store_id, j.metric_date, j.last_source_normalized_at
  )
  SELECT c.job_id, c.tenant_id, c.store_id, c.metric_date, c.last_source_normalized_at
  FROM claimed c;
END;
$$;

COMMIT;
