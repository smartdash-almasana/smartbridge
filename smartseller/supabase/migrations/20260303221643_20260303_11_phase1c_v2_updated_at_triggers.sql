-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1.C — Triggers updated_at en todas las tablas public que lo necesitan
-- Función set_updated_at() ya existe en public — no se recrea.
--
-- INVENTARIO DE TABLAS SIN TRIGGER (pre-migración):
--   V2 core:     v2_tenants, v2_sellers, v2_stores, v2_oauth_tokens,
--                v2_notification_policies, v2_reconciliation_jobs,
--                v2_webhook_ingest_jobs
--   Workers/obs: token_refresh_jobs
--   Legacy:      archive_jobs, archive_manifest, archive_rollup_monthly,
--                job_locks, meli_oauth_tokens, seller_clinical_profile,
--                store_archive_targets
--
-- Estrategia: DROP TRIGGER IF EXISTS + CREATE TRIGGER (idempotente)
-- Nomeclatura: trg_<table>_set_updated_at
-- ─────────────────────────────────────────────────────────────────────────────

-- ── V2 CORE ──────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_v2_tenants_set_updated_at ON public.v2_tenants;
CREATE TRIGGER trg_v2_tenants_set_updated_at
  BEFORE UPDATE ON public.v2_tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_v2_sellers_set_updated_at ON public.v2_sellers;
CREATE TRIGGER trg_v2_sellers_set_updated_at
  BEFORE UPDATE ON public.v2_sellers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_v2_stores_set_updated_at ON public.v2_stores;
CREATE TRIGGER trg_v2_stores_set_updated_at
  BEFORE UPDATE ON public.v2_stores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_v2_oauth_tokens_set_updated_at ON public.v2_oauth_tokens;
CREATE TRIGGER trg_v2_oauth_tokens_set_updated_at
  BEFORE UPDATE ON public.v2_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_v2_notification_policies_set_updated_at ON public.v2_notification_policies;
CREATE TRIGGER trg_v2_notification_policies_set_updated_at
  BEFORE UPDATE ON public.v2_notification_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_v2_reconciliation_jobs_set_updated_at ON public.v2_reconciliation_jobs;
CREATE TRIGGER trg_v2_reconciliation_jobs_set_updated_at
  BEFORE UPDATE ON public.v2_reconciliation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_v2_webhook_ingest_jobs_set_updated_at ON public.v2_webhook_ingest_jobs;
CREATE TRIGGER trg_v2_webhook_ingest_jobs_set_updated_at
  BEFORE UPDATE ON public.v2_webhook_ingest_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── WORKERS / OBSERVABILIDAD ──────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_token_refresh_jobs_set_updated_at ON public.token_refresh_jobs;
CREATE TRIGGER trg_token_refresh_jobs_set_updated_at
  BEFORE UPDATE ON public.token_refresh_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── LEGACY (cerrar deuda) ─────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_archive_jobs_set_updated_at ON public.archive_jobs;
CREATE TRIGGER trg_archive_jobs_set_updated_at
  BEFORE UPDATE ON public.archive_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_archive_manifest_set_updated_at ON public.archive_manifest;
CREATE TRIGGER trg_archive_manifest_set_updated_at
  BEFORE UPDATE ON public.archive_manifest
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_archive_rollup_monthly_set_updated_at ON public.archive_rollup_monthly;
CREATE TRIGGER trg_archive_rollup_monthly_set_updated_at
  BEFORE UPDATE ON public.archive_rollup_monthly
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_job_locks_set_updated_at ON public.job_locks;
CREATE TRIGGER trg_job_locks_set_updated_at
  BEFORE UPDATE ON public.job_locks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_meli_oauth_tokens_set_updated_at ON public.meli_oauth_tokens;
CREATE TRIGGER trg_meli_oauth_tokens_set_updated_at
  BEFORE UPDATE ON public.meli_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_seller_clinical_profile_set_updated_at ON public.seller_clinical_profile;
CREATE TRIGGER trg_seller_clinical_profile_set_updated_at
  BEFORE UPDATE ON public.seller_clinical_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_store_archive_targets_set_updated_at ON public.store_archive_targets;
CREATE TRIGGER trg_store_archive_targets_set_updated_at
  BEFORE UPDATE ON public.store_archive_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();;
