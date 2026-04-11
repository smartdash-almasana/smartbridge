
-- ============================================================
-- V2 Migration: tenant_id + dedupe_key + stub tables
-- Idempotente (IF NOT EXISTS / column existence checks)
-- 2026-02-26
-- ============================================================

-- ============================================================
-- A) ALTER v2_webhook_events: add tenant_id + dedupe_key
-- ============================================================
ALTER TABLE v2_webhook_events
  ADD COLUMN IF NOT EXISTS tenant_id  uuid,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

-- ============================================================
-- B) ALTER v2_domain_events: add tenant_id + store_id
-- ============================================================
ALTER TABLE v2_domain_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS store_id  uuid;

-- ============================================================
-- C) ALTER v2_clinical_signals + v2_health_scores: add tenant_id
-- ============================================================
ALTER TABLE v2_clinical_signals
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE v2_health_scores
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- ============================================================
-- D) Create stub tables if missing
-- ============================================================
CREATE TABLE IF NOT EXISTS v2_snapshots (
  snapshot_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,
  store_id    uuid,
  snapshot_at timestamptz,
  payload     jsonb       NOT NULL DEFAULT '{}',
  run_id      uuid
);

CREATE TABLE IF NOT EXISTS v2_metrics_daily (
  tenant_id   uuid  NOT NULL,
  store_id    uuid  NOT NULL,
  metric_date date  NOT NULL,
  metrics     jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, store_id, metric_date)
);

-- ============================================================
-- E) Backfill tenant_id from v2_stores where store_id matches
-- ============================================================

-- v2_webhook_events
UPDATE v2_webhook_events wh
SET tenant_id = s.tenant_id
FROM v2_stores s
WHERE wh.store_id = s.store_id
  AND wh.tenant_id IS NULL;

-- v2_domain_events (store_id from webhook join via source_event_id)
-- First backfill store_id from v2_webhook_events
UPDATE v2_domain_events de
SET store_id = wh.store_id
FROM v2_webhook_events wh
WHERE de.source_event_id = wh.event_id
  AND de.store_id IS NULL;

-- Then backfill tenant_id from v2_stores
UPDATE v2_domain_events de
SET tenant_id = s.tenant_id
FROM v2_stores s
WHERE de.store_id = s.store_id
  AND de.tenant_id IS NULL;

-- v2_clinical_signals
UPDATE v2_clinical_signals cs
SET tenant_id = s.tenant_id
FROM v2_stores s
WHERE cs.store_id = s.store_id
  AND cs.tenant_id IS NULL;

-- v2_health_scores
UPDATE v2_health_scores hs
SET tenant_id = s.tenant_id
FROM v2_stores s
WHERE hs.store_id = s.store_id
  AND hs.tenant_id IS NULL;

-- ============================================================
-- E2) Backfill dedupe_key on v2_webhook_events
-- Uses sha256 over provider_event_id || '|' || topic
-- Deterministic, safe for existing and future rows
-- ============================================================
UPDATE v2_webhook_events
SET dedupe_key = encode(
  sha256(
    (provider_event_id || '|' || topic)::bytea
  ),
  'hex'
)
WHERE dedupe_key IS NULL;

-- ============================================================
-- F) Indexes / Unique constraints (IF NOT EXISTS via DO block)
-- ============================================================

-- Unique index: v2_webhook_events(store_id, dedupe_key) where not null
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'v2_webhook_events'
      AND indexname  = 'uq_v2_webhook_events_store_dedupe'
  ) THEN
    CREATE UNIQUE INDEX uq_v2_webhook_events_store_dedupe
      ON v2_webhook_events (store_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL;
  END IF;
END $$;

-- Index on v2_domain_events(store_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'v2_domain_events'
      AND indexname  = 'idx_v2_domain_events_store_id'
  ) THEN
    CREATE INDEX idx_v2_domain_events_store_id
      ON v2_domain_events (store_id)
      WHERE store_id IS NOT NULL;
  END IF;
END $$;

-- Index on v2_snapshots(store_id, snapshot_at)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'v2_snapshots'
      AND indexname  = 'idx_v2_snapshots_store_at'
  ) THEN
    CREATE INDEX idx_v2_snapshots_store_at
      ON v2_snapshots (store_id, snapshot_at DESC);
  END IF;
END $$;
;
