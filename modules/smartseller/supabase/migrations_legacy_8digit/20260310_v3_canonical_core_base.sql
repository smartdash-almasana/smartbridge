-- SmartSeller V3 — Canonical Core Base Schema
-- Source ADRs: ADR-0009, ADR-0010, ADR-0011
-- Scope: core tables only (no adapters, no RPCs; includes minimal updated_at triggers)

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) v3_tenants
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_tenants (
  tenant_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key       text NOT NULL UNIQUE,
  display_name     text NOT NULL,
  status           text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2) v3_sellers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_sellers (
  seller_uuid      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  seller_key       text NOT NULL,
  display_name     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, seller_key),
  UNIQUE (tenant_id, seller_uuid)
);

CREATE INDEX IF NOT EXISTS idx_v3_sellers_tenant
  ON public.v3_sellers (tenant_id);

-- -----------------------------------------------------------------------------
-- 3) v3_stores
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_stores (
  store_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  seller_uuid      uuid NOT NULL,
  store_key        text NOT NULL,
  provider_key     text NOT NULL CHECK (provider_key IN ('mercadolibre', 'shopify', 'system')),
  status           text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_key, store_key),
  UNIQUE (tenant_id, store_id),
  FOREIGN KEY (tenant_id, seller_uuid)
    REFERENCES public.v3_sellers (tenant_id, seller_uuid)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_stores_tenant_seller
  ON public.v3_stores (tenant_id, seller_uuid);

-- -----------------------------------------------------------------------------
-- 4) v3_webhook_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_webhook_events (
  webhook_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  store_id         uuid NOT NULL,
  provider_key     text NOT NULL CHECK (provider_key IN ('mercadolibre', 'shopify', 'system')),
  dedupe_key       text NOT NULL,
  source_event_id  text NOT NULL,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processing_status text NOT NULL DEFAULT 'pending'
                    CHECK (processing_status IN ('pending', 'processed', 'error', 'ignored')),
  UNIQUE (tenant_id, store_id, provider_key, dedupe_key),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES public.v3_stores (tenant_id, store_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_webhook_events_store_received
  ON public.v3_webhook_events (tenant_id, store_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_v3_webhook_events_status_received
  ON public.v3_webhook_events (processing_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_v3_webhook_events_store_status
  ON public.v3_webhook_events (store_id, processing_status);

-- -----------------------------------------------------------------------------
-- 5) v3_domain_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_domain_events (
  domain_event_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  store_id         uuid NOT NULL,
  provider_key     text NOT NULL CHECK (provider_key IN ('mercadolibre', 'shopify', 'system')),
  source_event_id  text NOT NULL,
  source_webhook_event_id uuid NOT NULL REFERENCES public.v3_webhook_events(webhook_event_id) ON DELETE RESTRICT,
  event_type       text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  payload          jsonb NOT NULL,
  occurred_at      timestamptz NOT NULL,
  normalized_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, provider_key, source_event_id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES public.v3_stores (tenant_id, store_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_domain_events_store_occurred
  ON public.v3_domain_events (tenant_id, store_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_v3_domain_events_event_type
  ON public.v3_domain_events (event_type, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- 6) v3_engine_runs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_engine_runs (
  run_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  store_id         uuid NOT NULL,
  metric_date      date NOT NULL,
  orchestrator_key text NOT NULL DEFAULT 'clinical_orchestrator_v1',
  status           text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, metric_date, orchestrator_key),
  UNIQUE (tenant_id, store_id, run_id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES public.v3_stores (tenant_id, store_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_engine_runs_store_started
  ON public.v3_engine_runs (tenant_id, store_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_v3_engine_runs_status_started
  ON public.v3_engine_runs (status, started_at DESC);

-- -----------------------------------------------------------------------------
-- 7) v3_snapshots
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_snapshots (
  snapshot_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  store_id         uuid NOT NULL,
  run_id           uuid NOT NULL,
  snapshot_at      timestamptz NOT NULL DEFAULT now(),
  payload          jsonb NOT NULL,
  UNIQUE (tenant_id, store_id, run_id),
  UNIQUE (tenant_id, store_id, snapshot_id),
  FOREIGN KEY (tenant_id, store_id, run_id)
    REFERENCES public.v3_engine_runs (tenant_id, store_id, run_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_snapshots_store_snapshot_at
  ON public.v3_snapshots (tenant_id, store_id, snapshot_at DESC);

-- -----------------------------------------------------------------------------
-- 8) v3_metrics_daily
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_metrics_daily (
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  store_id         uuid NOT NULL,
  metric_date      date NOT NULL,
  run_id           uuid NOT NULL,
  snapshot_id      uuid NOT NULL,
  metrics          jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, store_id, metric_date),
  FOREIGN KEY (tenant_id, store_id, run_id)
    REFERENCES public.v3_engine_runs (tenant_id, store_id, run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, snapshot_id)
    REFERENCES public.v3_snapshots (tenant_id, store_id, snapshot_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_metrics_daily_run
  ON public.v3_metrics_daily (tenant_id, store_id, run_id);

-- -----------------------------------------------------------------------------
-- 9) v3_clinical_signals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_clinical_signals (
  signal_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  store_id         uuid NOT NULL,
  run_id           uuid NOT NULL,
  snapshot_id      uuid NOT NULL,
  signal_key       text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('none', 'info', 'warning', 'critical')),
  evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, run_id, signal_key),
  FOREIGN KEY (tenant_id, store_id, run_id)
    REFERENCES public.v3_engine_runs (tenant_id, store_id, run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, snapshot_id)
    REFERENCES public.v3_snapshots (tenant_id, store_id, snapshot_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_clinical_signals_store_created
  ON public.v3_clinical_signals (tenant_id, store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_v3_clinical_signals_signal_key
  ON public.v3_clinical_signals (signal_key, created_at DESC);

-- -----------------------------------------------------------------------------
-- 10) v3_health_scores
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_health_scores (
  score_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.v3_tenants(tenant_id) ON DELETE RESTRICT,
  store_id         uuid NOT NULL,
  run_id           uuid NOT NULL,
  snapshot_id      uuid NOT NULL,
  score            numeric NOT NULL CHECK (score >= 0 AND score <= 100),
  score_payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, run_id),
  FOREIGN KEY (tenant_id, store_id, run_id)
    REFERENCES public.v3_engine_runs (tenant_id, store_id, run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, snapshot_id)
    REFERENCES public.v3_snapshots (tenant_id, store_id, snapshot_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_health_scores_store_computed
  ON public.v3_health_scores (tenant_id, store_id, computed_at DESC);

-- -----------------------------------------------------------------------------
-- updated_at maintenance (minimum correct mechanism)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.v3_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_v3_tenants_set_updated_at ON public.v3_tenants;
CREATE TRIGGER trg_v3_tenants_set_updated_at
BEFORE UPDATE ON public.v3_tenants
FOR EACH ROW EXECUTE FUNCTION public.v3_set_updated_at();

DROP TRIGGER IF EXISTS trg_v3_sellers_set_updated_at ON public.v3_sellers;
CREATE TRIGGER trg_v3_sellers_set_updated_at
BEFORE UPDATE ON public.v3_sellers
FOR EACH ROW EXECUTE FUNCTION public.v3_set_updated_at();

DROP TRIGGER IF EXISTS trg_v3_stores_set_updated_at ON public.v3_stores;
CREATE TRIGGER trg_v3_stores_set_updated_at
BEFORE UPDATE ON public.v3_stores
FOR EACH ROW EXECUTE FUNCTION public.v3_set_updated_at();

DROP TRIGGER IF EXISTS trg_v3_engine_runs_set_updated_at ON public.v3_engine_runs;
CREATE TRIGGER trg_v3_engine_runs_set_updated_at
BEFORE UPDATE ON public.v3_engine_runs
FOR EACH ROW EXECUTE FUNCTION public.v3_set_updated_at();

COMMIT;
