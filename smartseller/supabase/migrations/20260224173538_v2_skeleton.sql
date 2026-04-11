-- ============================================================================
-- SmartSeller — DDL V2 Skeleton
-- Migration:  20260224_v2_skeleton
-- Canon:      ADR-001-v2, ADR-002-v2, ADR-003-v3, ADR-004-v3, ADR-005-v1
-- Scope:      tenants, sellers, stores, webhook_events, domain_events (v2_*)
-- ============================================================================

-- ─── 1. public.v2_tenants ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_tenants (
  tenant_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v2_tenants_created_at
  ON public.v2_tenants (created_at);

-- ─── 2. public.v2_sellers ────────────────────────────────────────────────────
-- Internal clinical identity (L3). Stable across credential rotation.
-- seller_uuid is globally unique; never equals external_account_id (different type/domain).
CREATE TABLE IF NOT EXISTS public.v2_sellers (
  seller_uuid  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL
    REFERENCES public.v2_tenants (tenant_id) ON DELETE RESTRICT,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v2_sellers_tenant_id
  ON public.v2_sellers (tenant_id);

-- ─── 3. public.v2_stores ─────────────────────────────────────────────────────
-- Channel connection (L2/L4). seller_uuid NOT UNIQUE here: 1 seller → N stores.
-- external_account_id is TEXT, never FK target, never cast to numeric.
CREATE TABLE IF NOT EXISTS public.v2_stores (
  store_id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL
    REFERENCES public.v2_tenants (tenant_id) ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL
    REFERENCES public.v2_sellers (seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL
    CONSTRAINT v2_stores_provider_key_check
      CHECK (provider_key IN ('mercadolibre', 'shopify')),
  external_account_id   text        NOT NULL,
  connection_status     text        NOT NULL DEFAULT 'connected'
    CONSTRAINT v2_stores_connection_status_check
      CHECK (connection_status IN ('connected', 'disconnected', 'uninstalled', 'error')),
  market                text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_stores_tenant_provider_account
    UNIQUE (tenant_id, provider_key, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_stores_seller_uuid
  ON public.v2_stores (seller_uuid);

CREATE INDEX IF NOT EXISTS idx_v2_stores_tenant_id
  ON public.v2_stores (tenant_id);

CREATE INDEX IF NOT EXISTS idx_v2_stores_connection_status
  ON public.v2_stores (connection_status);

-- ─── 4. public.v2_webhook_events ─────────────────────────────────────────────
-- Immutable raw ingest. Idempotency: UNIQUE (store_id, provider_event_id).
CREATE TABLE IF NOT EXISTS public.v2_webhook_events (
  event_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid        NOT NULL
    REFERENCES public.v2_stores (store_id) ON DELETE RESTRICT,
  provider_event_id text        NOT NULL,
  topic             text        NOT NULL,
  resource          text,
  provider_user_id  text,
  raw_payload       jsonb,
  received_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_webhook_events_store_event
    UNIQUE (store_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_webhook_events_received_at
  ON public.v2_webhook_events (store_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_v2_webhook_events_topic
  ON public.v2_webhook_events (store_id, topic);

-- ─── 5. public.v2_domain_events ──────────────────────────────────────────────
-- Normalized events (pipeline stage 2). Idempotency: UNIQUE (store_id, source_event_id, event_type).
CREATE TABLE IF NOT EXISTS public.v2_domain_events (
  domain_event_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid        NOT NULL
    REFERENCES public.v2_stores (store_id) ON DELETE RESTRICT,
  seller_uuid       uuid        NOT NULL
    REFERENCES public.v2_sellers (seller_uuid) ON DELETE RESTRICT,
  source_event_id   uuid        NOT NULL
    REFERENCES public.v2_webhook_events (event_id) ON DELETE RESTRICT,
  event_type        text        NOT NULL,
  entity_type       text        NOT NULL,
  entity_id         text        NOT NULL,
  payload           jsonb,
  occurred_at       timestamptz,
  normalized_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_domain_events_store_source_type
    UNIQUE (store_id, source_event_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_v2_domain_events_occurred_at
  ON public.v2_domain_events (store_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_v2_domain_events_seller_uuid
  ON public.v2_domain_events (seller_uuid, event_type);

CREATE INDEX IF NOT EXISTS idx_v2_domain_events_entity
  ON public.v2_domain_events (store_id, entity_type, entity_id);;
