
-- ============================================================
-- V2 RLS Multi-Tenant — 2026-02-26
-- Membership fuente: v2_store_memberships (tenant_id, user_id)
-- Policy SELECT: auth.uid() debe pertenecer al tenant_id de la fila
-- INSERT/UPDATE/DELETE: cerradas para auth users (service role bypass RLS)
-- ============================================================

-- ============================================================
-- 1) ENABLE RLS en las 6 tablas (idempotente: no falla si ya está)
-- ============================================================
ALTER TABLE v2_webhook_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_domain_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_snapshots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_metrics_daily     ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_clinical_signals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2_health_scores     ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) DROP + CREATE policies (idempotente via DROP IF EXISTS)
-- ============================================================

-- v2_webhook_events
DROP POLICY IF EXISTS v2_rls_select_tenant ON v2_webhook_events;
CREATE POLICY v2_rls_select_tenant ON v2_webhook_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM v2_store_memberships tm
      WHERE tm.tenant_id = v2_webhook_events.tenant_id
        AND tm.user_id   = auth.uid()
    )
  );

-- v2_domain_events
DROP POLICY IF EXISTS v2_rls_select_tenant ON v2_domain_events;
CREATE POLICY v2_rls_select_tenant ON v2_domain_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM v2_store_memberships tm
      WHERE tm.tenant_id = v2_domain_events.tenant_id
        AND tm.user_id   = auth.uid()
    )
  );

-- v2_snapshots
DROP POLICY IF EXISTS v2_rls_select_tenant ON v2_snapshots;
CREATE POLICY v2_rls_select_tenant ON v2_snapshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM v2_store_memberships tm
      WHERE tm.tenant_id = v2_snapshots.tenant_id
        AND tm.user_id   = auth.uid()
    )
  );

-- v2_metrics_daily
DROP POLICY IF EXISTS v2_rls_select_tenant ON v2_metrics_daily;
CREATE POLICY v2_rls_select_tenant ON v2_metrics_daily
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM v2_store_memberships tm
      WHERE tm.tenant_id = v2_metrics_daily.tenant_id
        AND tm.user_id   = auth.uid()
    )
  );

-- v2_clinical_signals
DROP POLICY IF EXISTS v2_rls_select_tenant ON v2_clinical_signals;
CREATE POLICY v2_rls_select_tenant ON v2_clinical_signals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM v2_store_memberships tm
      WHERE tm.tenant_id = v2_clinical_signals.tenant_id
        AND tm.user_id   = auth.uid()
    )
  );

-- v2_health_scores
DROP POLICY IF EXISTS v2_rls_select_tenant ON v2_health_scores;
CREATE POLICY v2_rls_select_tenant ON v2_health_scores
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM v2_store_memberships tm
      WHERE tm.tenant_id = v2_health_scores.tenant_id
        AND tm.user_id   = auth.uid()
    )
  );
;
