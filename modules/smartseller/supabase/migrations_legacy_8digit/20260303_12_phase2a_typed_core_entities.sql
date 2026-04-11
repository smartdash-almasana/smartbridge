-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2.A — Entidades tipadas core V1
-- Migration: 20260303_12_phase2a_typed_core_entities.sql
-- Contrato: docs/architecture/V1_CORE_ENTITIES_SPEC.md
--           docs/architecture/ADR_STORE_ID_AS_OPERATIONAL_UNIT.md
--
-- Invariantes aplicados:
--   - Multi-tenant DB-enforced (tenant_id, store_id, seller_uuid NOT NULL + FK)
--   - Idempotencia: UNIQUE(provider_key, store_id, <external_id>)
--   - Refund ≠ Payment: tablas separadas
--   - Multi-currency: amount + currency_code NOT NULL en entidades financieras
--   - JSONB = evidencia: raw_jsonb NOT NULL DEFAULT '{}'
--   - Writer contract: last_occurred_at + last_source_event_id NOT NULL
--   - updated_at: trigger set_updated_at en cada tabla
--
-- Nota de tipo: tenant_id es uuid (DB real) no text (spec doc usa text; realidad uuid)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. v2_orders ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_orders (
  order_id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id)  ON DELETE RESTRICT,
  store_id              uuid        NOT NULL REFERENCES public.v2_stores(store_id)    ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL,
  order_external_id     text        NOT NULL,
  order_status          text        NOT NULL,
  total_amount          numeric     NOT NULL,
  currency_code         text        NOT NULL,
  created_at_provider   timestamptz,
  closed_at_provider    timestamptz,
  raw_jsonb             jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at      timestamptz NOT NULL,
  last_source_event_id  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_orders_identity UNIQUE (provider_key, store_id, order_external_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_orders_store_status_at
  ON public.v2_orders (store_id, order_status, last_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_orders_tenant_store
  ON public.v2_orders (tenant_id, store_id);

DROP TRIGGER IF EXISTS trg_v2_orders_set_updated_at ON public.v2_orders;
CREATE TRIGGER trg_v2_orders_set_updated_at
  BEFORE UPDATE ON public.v2_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. v2_order_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_order_items (
  item_id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id)  ON DELETE RESTRICT,
  store_id              uuid        NOT NULL REFERENCES public.v2_stores(store_id)    ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL,
  order_external_id     text        NOT NULL,
  line_external_id      text        NOT NULL,
  quantity              integer     NOT NULL,
  unit_price_amount     numeric     NOT NULL,
  unit_price_currency   text        NOT NULL,
  fees_amount           numeric,
  fees_currency         text,
  raw_jsonb             jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at      timestamptz NOT NULL,
  last_source_event_id  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_order_items_identity
    UNIQUE (provider_key, store_id, order_external_id, line_external_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_order_items_order
  ON public.v2_order_items (store_id, order_external_id);
CREATE INDEX IF NOT EXISTS idx_v2_order_items_tenant_store
  ON public.v2_order_items (tenant_id, store_id);

DROP TRIGGER IF EXISTS trg_v2_order_items_set_updated_at ON public.v2_order_items;
CREATE TRIGGER trg_v2_order_items_set_updated_at
  BEFORE UPDATE ON public.v2_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. v2_fulfillments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.v2_fulfillments (
  fulfillment_id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                 uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id)  ON DELETE RESTRICT,
  store_id                  uuid        NOT NULL REFERENCES public.v2_stores(store_id)    ON DELETE RESTRICT,
  seller_uuid               uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key              text        NOT NULL,
  fulfillment_external_id   text        NOT NULL,
  order_external_id         text        NOT NULL,
  fulfillment_status        text        NOT NULL,
  must_ship_by              timestamptz,
  shipped_at_provider       timestamptz,
  delivered_at_provider     timestamptz,
  location_external_id      text,
  sla_status                text        NOT NULL DEFAULT 'sla_unknown'
    CHECK (sla_status IN ('sla_unknown','sla_ok','sla_at_risk','sla_breached')),
  raw_jsonb                 jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at          timestamptz NOT NULL,
  last_source_event_id      text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_fulfillments_identity
    UNIQUE (provider_key, store_id, fulfillment_external_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_fulfillments_order
  ON public.v2_fulfillments (store_id, order_external_id);
CREATE INDEX IF NOT EXISTS idx_v2_fulfillments_sla
  ON public.v2_fulfillments (store_id, sla_status, must_ship_by)
  WHERE sla_status != 'sla_unknown';
CREATE INDEX IF NOT EXISTS idx_v2_fulfillments_tenant_store
  ON public.v2_fulfillments (tenant_id, store_id);

DROP TRIGGER IF EXISTS trg_v2_fulfillments_set_updated_at ON public.v2_fulfillments;
CREATE TRIGGER trg_v2_fulfillments_set_updated_at
  BEFORE UPDATE ON public.v2_fulfillments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. v2_payments ───────────────────────────────────────────────────────────
-- INVARIANTE: Refund ≠ Payment — entidades separadas
CREATE TABLE IF NOT EXISTS public.v2_payments (
  payment_id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id)  ON DELETE RESTRICT,
  store_id              uuid        NOT NULL REFERENCES public.v2_stores(store_id)    ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL,
  payment_external_id   text        NOT NULL,
  order_external_id     text,
  payment_status        text        NOT NULL,
  amount                numeric     NOT NULL,
  currency_code         text        NOT NULL,
  paid_at_provider      timestamptz,
  raw_jsonb             jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at      timestamptz NOT NULL,
  last_source_event_id  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_payments_identity
    UNIQUE (provider_key, store_id, payment_external_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_payments_orphan
  ON public.v2_payments (store_id, payment_external_id)
  WHERE order_external_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_v2_payments_order
  ON public.v2_payments (store_id, order_external_id)
  WHERE order_external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_payments_tenant_store
  ON public.v2_payments (tenant_id, store_id);

DROP TRIGGER IF EXISTS trg_v2_payments_set_updated_at ON public.v2_payments;
CREATE TRIGGER trg_v2_payments_set_updated_at
  BEFORE UPDATE ON public.v2_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. v2_refunds ────────────────────────────────────────────────────────────
-- INVARIANTE: Refund ≠ Payment — semántica de reversión, nunca de cobro
CREATE TABLE IF NOT EXISTS public.v2_refunds (
  refund_id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id)  ON DELETE RESTRICT,
  store_id              uuid        NOT NULL REFERENCES public.v2_stores(store_id)    ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL,
  refund_external_id    text        NOT NULL,
  payment_external_id   text,
  order_external_id     text,
  amount                numeric     NOT NULL,
  currency_code         text        NOT NULL,
  refunded_at_provider  timestamptz,
  raw_jsonb             jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at      timestamptz NOT NULL,
  last_source_event_id  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_v2_refunds_identity
    UNIQUE (provider_key, store_id, refund_external_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_refunds_payment
  ON public.v2_refunds (store_id, payment_external_id)
  WHERE payment_external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_refunds_order
  ON public.v2_refunds (store_id, order_external_id)
  WHERE order_external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_refunds_tenant_store
  ON public.v2_refunds (tenant_id, store_id);

DROP TRIGGER IF EXISTS trg_v2_refunds_set_updated_at ON public.v2_refunds;
CREATE TRIGGER trg_v2_refunds_set_updated_at
  BEFORE UPDATE ON public.v2_refunds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
