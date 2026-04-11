BEGIN;

ALTER TABLE public.v3_snapshot_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_metrics_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_signals_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_scores_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_worker_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS v3_snapshot_jobs_deny_anon ON public.v3_snapshot_jobs;
CREATE POLICY v3_snapshot_jobs_deny_anon
ON public.v3_snapshot_jobs
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_snapshot_jobs_deny_authenticated ON public.v3_snapshot_jobs;
CREATE POLICY v3_snapshot_jobs_deny_authenticated
ON public.v3_snapshot_jobs
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_metrics_jobs_deny_anon ON public.v3_metrics_jobs;
CREATE POLICY v3_metrics_jobs_deny_anon
ON public.v3_metrics_jobs
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_metrics_jobs_deny_authenticated ON public.v3_metrics_jobs;
CREATE POLICY v3_metrics_jobs_deny_authenticated
ON public.v3_metrics_jobs
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_signals_jobs_deny_anon ON public.v3_signals_jobs;
CREATE POLICY v3_signals_jobs_deny_anon
ON public.v3_signals_jobs
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_signals_jobs_deny_authenticated ON public.v3_signals_jobs;
CREATE POLICY v3_signals_jobs_deny_authenticated
ON public.v3_signals_jobs
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_scores_jobs_deny_anon ON public.v3_scores_jobs;
CREATE POLICY v3_scores_jobs_deny_anon
ON public.v3_scores_jobs
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_scores_jobs_deny_authenticated ON public.v3_scores_jobs;
CREATE POLICY v3_scores_jobs_deny_authenticated
ON public.v3_scores_jobs
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_worker_heartbeats_deny_anon ON public.v3_worker_heartbeats;
CREATE POLICY v3_worker_heartbeats_deny_anon
ON public.v3_worker_heartbeats
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_worker_heartbeats_deny_authenticated ON public.v3_worker_heartbeats;
CREATE POLICY v3_worker_heartbeats_deny_authenticated
ON public.v3_worker_heartbeats
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

COMMIT;
