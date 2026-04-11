-- ============================================================================
-- SmartSeller — Fase B: Identity Canon V2 — Data Migration V1 → V2
-- Migration:  20260224_v2_identity_b_seed
-- Canon:      ADR-001-v2 (seller_uuid reutilizado desde V1)
-- Rules:
--   - 1 tenant "smartseller_core" created as L1 root.
--   - seller_uuid preserved from V1 (identity continuity).
--   - provider_key canonicalized: 'meli' → 'mercadolibre'.
--   - external_account_id := V1.external_id (TEXT, no cast).
--   - Full transactional: all-or-nothing.
-- ============================================================================

BEGIN;

-- ─── Step 1: Create default tenant (L1) ──────────────────────────────────────
INSERT INTO public.v2_tenants (name)
VALUES ('smartseller_core')
ON CONFLICT DO NOTHING;

-- ─── Step 2: Migrate sellers (L3) — reuse seller_uuid from V1 ───────────────
-- tenant_id resolved inline via subquery to avoid variable dependency.
INSERT INTO public.v2_sellers (seller_uuid, tenant_id, display_name)
SELECT
  s.seller_uuid,
  (SELECT tenant_id FROM public.v2_tenants WHERE name = 'smartseller_core' LIMIT 1),
  NULL
FROM public.sellers s
ON CONFLICT (seller_uuid) DO NOTHING;

-- ─── Step 3: Migrate stores (L2/L4) — 1 store per (seller × provider) ───────
-- provider_key canonicalization: 'meli' → 'mercadolibre'.
-- external_account_id := V1.external_id (TEXT, verbatim).
-- ON CONFLICT: update seller_uuid to keep identity fresh (upsert-safe).
INSERT INTO public.v2_stores (
  tenant_id,
  seller_uuid,
  provider_key,
  external_account_id,
  connection_status,
  market
)
SELECT
  (SELECT tenant_id FROM public.v2_tenants WHERE name = 'smartseller_core' LIMIT 1),
  s.seller_uuid,
  CASE WHEN s.provider_key = 'meli' THEN 'mercadolibre' ELSE s.provider_key END,
  s.external_id,
  'connected',
  s.market
FROM public.sellers s
ON CONFLICT (tenant_id, provider_key, external_account_id)
  DO UPDATE SET
    seller_uuid = EXCLUDED.seller_uuid,
    updated_at  = now();

COMMIT;;
