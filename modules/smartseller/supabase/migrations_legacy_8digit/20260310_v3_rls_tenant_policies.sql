-- SmartSeller V3 — Tenant-aware RLS policies (post baseline)
-- Depends on: 20260310_v3_core_rls_base.sql
-- Scope: minimal internal operational reads, keep default-deny elsewhere.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Secure helper: resolve tenant_id from JWT claims
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_session_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claims jsonb;
  tenant_txt text;
BEGIN
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  IF claims IS NULL THEN
    RETURN NULL;
  END IF;

  tenant_txt := COALESCE(
    claims ->> 'tenant_id',
    claims #>> '{app_metadata,tenant_id}',
    claims #>> '{user_metadata,tenant_id}'
  );

  IF tenant_txt IS NULL OR btrim(tenant_txt) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN tenant_txt::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_session_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_tenant_id() TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) Tenant-aware read policies (minimal operational internal scope)
-- -----------------------------------------------------------------------------
-- Keep default-deny from baseline; add selective authenticated read where needed.

DROP POLICY IF EXISTS v3_stores_select_tenant_authenticated ON public.v3_stores;
CREATE POLICY v3_stores_select_tenant_authenticated
ON public.v3_stores
FOR SELECT
TO authenticated
USING (tenant_id = public.get_session_tenant_id());

DROP POLICY IF EXISTS v3_clinical_signals_select_tenant_authenticated ON public.v3_clinical_signals;
CREATE POLICY v3_clinical_signals_select_tenant_authenticated
ON public.v3_clinical_signals
FOR SELECT
TO authenticated
USING (tenant_id = public.get_session_tenant_id());

DROP POLICY IF EXISTS v3_health_scores_select_tenant_authenticated ON public.v3_health_scores;
CREATE POLICY v3_health_scores_select_tenant_authenticated
ON public.v3_health_scores
FOR SELECT
TO authenticated
USING (tenant_id = public.get_session_tenant_id());

COMMIT;
