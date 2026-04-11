-- SmartSeller V3 — Core RLS Baseline
-- ADR-0012: default-deny for client roles before any production ingest.
-- Note: service_role/backend keeps operating via Supabase natural BYPASSRLS behavior.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Enable RLS on all V3 core tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.v3_tenants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_sellers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_stores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_webhook_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_domain_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_engine_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_snapshots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_metrics_daily     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_clinical_signals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_health_scores     ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2) Default-deny for anon/authenticated (no direct client access)
-- -----------------------------------------------------------------------------
-- v3_tenants
DROP POLICY IF EXISTS v3_tenants_deny_anon ON public.v3_tenants;
CREATE POLICY v3_tenants_deny_anon
ON public.v3_tenants
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_tenants_deny_authenticated ON public.v3_tenants;
CREATE POLICY v3_tenants_deny_authenticated
ON public.v3_tenants
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_sellers
DROP POLICY IF EXISTS v3_sellers_deny_anon ON public.v3_sellers;
CREATE POLICY v3_sellers_deny_anon
ON public.v3_sellers
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_sellers_deny_authenticated ON public.v3_sellers;
CREATE POLICY v3_sellers_deny_authenticated
ON public.v3_sellers
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_stores
DROP POLICY IF EXISTS v3_stores_deny_anon ON public.v3_stores;
CREATE POLICY v3_stores_deny_anon
ON public.v3_stores
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_stores_deny_authenticated ON public.v3_stores;
CREATE POLICY v3_stores_deny_authenticated
ON public.v3_stores
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_webhook_events
DROP POLICY IF EXISTS v3_webhook_events_deny_anon ON public.v3_webhook_events;
CREATE POLICY v3_webhook_events_deny_anon
ON public.v3_webhook_events
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_webhook_events_deny_authenticated ON public.v3_webhook_events;
CREATE POLICY v3_webhook_events_deny_authenticated
ON public.v3_webhook_events
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_domain_events
DROP POLICY IF EXISTS v3_domain_events_deny_anon ON public.v3_domain_events;
CREATE POLICY v3_domain_events_deny_anon
ON public.v3_domain_events
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_domain_events_deny_authenticated ON public.v3_domain_events;
CREATE POLICY v3_domain_events_deny_authenticated
ON public.v3_domain_events
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_engine_runs
DROP POLICY IF EXISTS v3_engine_runs_deny_anon ON public.v3_engine_runs;
CREATE POLICY v3_engine_runs_deny_anon
ON public.v3_engine_runs
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_engine_runs_deny_authenticated ON public.v3_engine_runs;
CREATE POLICY v3_engine_runs_deny_authenticated
ON public.v3_engine_runs
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_snapshots
DROP POLICY IF EXISTS v3_snapshots_deny_anon ON public.v3_snapshots;
CREATE POLICY v3_snapshots_deny_anon
ON public.v3_snapshots
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_snapshots_deny_authenticated ON public.v3_snapshots;
CREATE POLICY v3_snapshots_deny_authenticated
ON public.v3_snapshots
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_metrics_daily
DROP POLICY IF EXISTS v3_metrics_daily_deny_anon ON public.v3_metrics_daily;
CREATE POLICY v3_metrics_daily_deny_anon
ON public.v3_metrics_daily
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_metrics_daily_deny_authenticated ON public.v3_metrics_daily;
CREATE POLICY v3_metrics_daily_deny_authenticated
ON public.v3_metrics_daily
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_clinical_signals
DROP POLICY IF EXISTS v3_clinical_signals_deny_anon ON public.v3_clinical_signals;
CREATE POLICY v3_clinical_signals_deny_anon
ON public.v3_clinical_signals
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_clinical_signals_deny_authenticated ON public.v3_clinical_signals;
CREATE POLICY v3_clinical_signals_deny_authenticated
ON public.v3_clinical_signals
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- v3_health_scores
DROP POLICY IF EXISTS v3_health_scores_deny_anon ON public.v3_health_scores;
CREATE POLICY v3_health_scores_deny_anon
ON public.v3_health_scores
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_health_scores_deny_authenticated ON public.v3_health_scores;
CREATE POLICY v3_health_scores_deny_authenticated
ON public.v3_health_scores
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

COMMIT;;
