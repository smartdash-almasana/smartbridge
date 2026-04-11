-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2.A — Entidades tipadas core V1
-- Contrato: docs/architecture/V1_CORE_ENTITIES_SPEC.md
--           docs/architecture/ADR_STORE_ID_AS_OPERATIONAL_UNIT.md
--
-- Notas de tipo:
--   - tenant_id: uuid (DB real, no text como dice el spec doc)
--   - UNIQUE de idempotencia: (provider_key, store_id, <external_id específico>)
--   - FKs: v2_order_items/fulfillments/payments → v2_orders vía (store_id, order_external_id)
--   - Refund ≠ Payment: tablas separadas, sin mezcla semántica
--   - Multi-currency: amount + currency_code NOT NULL en todas las financieras
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. v2_orders ─────────────────────────────────────────────────────────────
-- Contrato ref: V1_CORE_ENTITIES_SPEC.md:25-35
CREATE TABLE IF NOT EXISTS public.v2_orders (
  -- PK interna
  order_id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Identidad multi-tenant DB-enforced (ADR_STORE_ID:22-27)
  tenant_id             uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id) ON DELETE RESTRICT,
  store_id              uuid        NOT NULL REFERENCES public.v2_stores(store_id)   ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL,
  -- Provider identity
  order_external_id     text        NOT NULL,
  -- Campos clínicos mínimos (spec:27-32)
  order_status          text        NOT NULL,
  total_amount          numeric     NOT NULL,
  currency_code         text        NOT NULL,
  created_at_provider   timestamptz,
  closed_at_provider    timestamptz,
  -- Evidencia raw (Constitución: JSONB = evidencia, no dominio)
  raw_jsonb             jsonb       NOT NULL DEFAULT '{}',
  -- Writer contract (spec:97-101)
  last_occurred_at      timestamptz NOT NULL,
  last_source_event_id  text        NOT NULL,
  -- Auditoría
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Idempotencia (spec:20-21, ADR:29-30)
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
-- Contrato ref: V1_CORE_ENTITIES_SPEC.md:38-48
CREATE TABLE IF NOT EXISTS public.v2_order_items (
  item_id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Identidad multi-tenant
  tenant_id             uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id) ON DELETE RESTRICT,
  store_id              uuid        NOT NULL REFERENCES public.v2_stores(store_id)   ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL,
  -- FK a orden parent (referencia lógica por external_id — el FK físico va via UNIQUE de v2_orders)
  order_external_id     text        NOT NULL,
  -- Provider identity de ítem
  line_external_id      text        NOT NULL,
  -- Campos clínicos (spec:41-46)
  quantity              integer     NOT NULL,
  unit_price_amount     numeric     NOT NULL,
  unit_price_currency   text        NOT NULL,
  fees_amount           numeric,
  fees_currency         text,
  -- Evidencia + writer contract
  raw_jsonb             jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at      timestamptz NOT NULL,
  last_source_event_id  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Idempotencia (spec:48)
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
-- Contrato ref: V1_CORE_ENTITIES_SPEC.md:52-68
CREATE TABLE IF NOT EXISTS public.v2_fulfillments (
  fulfillment_id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Identidad multi-tenant
  tenant_id                 uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id) ON DELETE RESTRICT,
  store_id                  uuid        NOT NULL REFERENCES public.v2_stores(store_id)   ON DELETE RESTRICT,
  seller_uuid               uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key              text        NOT NULL,
  -- Provider identity
  fulfillment_external_id   text        NOT NULL,
  order_external_id         text        NOT NULL,
  -- Campos clínicos (spec:54-60)
  fulfillment_status        text        NOT NULL,
  must_ship_by              timestamptz,
  shipped_at_provider       timestamptz,
  delivered_at_provider     timestamptz,
  location_external_id      text,
  -- SLA (spec:63-68) — enum enforced
  sla_status                text        NOT NULL DEFAULT 'sla_unknown'
    CHECK (sla_status IN ('sla_unknown','sla_ok','sla_at_risk','sla_breached')),
  -- Evidencia + writer contract
  raw_jsonb                 jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at          timestamptz NOT NULL,
  last_source_event_id      text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- Idempotencia
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
-- Contrato ref: V1_CORE_ENTITIES_SPEC.md:72-79
-- INVARIANTE: Refund ≠ Payment — tablas separadas, sin mezcla semántica
CREATE TABLE IF NOT EXISTS public.v2_payments (
  payment_id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Identidad multi-tenant
  tenant_id             uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id) ON DELETE RESTRICT,
  store_id              uuid        NOT NULL REFERENCES public.v2_stores(store_id)   ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL,
  -- Provider identity
  payment_external_id   text        NOT NULL,
  -- Relación con orden (nullable: spec:78 "order_external_id (text NULL)")
  order_external_id     text,
  -- Campos financieros — multi-currency NOT NULL (Constitución §3)
  payment_status        text        NOT NULL,
  amount                numeric     NOT NULL,
  currency_code         text        NOT NULL,
  paid_at_provider      timestamptz,
  -- Evidencia + writer contract
  raw_jsonb             jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at      timestamptz NOT NULL,
  last_source_event_id  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Idempotencia
  CONSTRAINT uq_v2_payments_identity
    UNIQUE (provider_key, store_id, payment_external_id)
);

-- Índice para payments sin order (spec implícito: payments pueden existir sin orden)
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
-- Contrato ref: V1_CORE_ENTITIES_SPEC.md:83-90
-- INVARIANTE: Refund ≠ Payment — entidad separada, semántica de reversión
CREATE TABLE IF NOT EXISTS public.v2_refunds (
  refund_id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Identidad multi-tenant
  tenant_id             uuid        NOT NULL REFERENCES public.v2_tenants(tenant_id) ON DELETE RESTRICT,
  store_id              uuid        NOT NULL REFERENCES public.v2_stores(store_id)   ON DELETE RESTRICT,
  seller_uuid           uuid        NOT NULL REFERENCES public.v2_sellers(seller_uuid) ON DELETE RESTRICT,
  provider_key          text        NOT NULL,
  -- Provider identity
  refund_external_id    text        NOT NULL,
  -- Relaciones (ambas nullable: spec:88-89)
  payment_external_id   text,
  order_external_id     text,
  -- Campos financieros — multi-currency NOT NULL
  amount                numeric     NOT NULL,
  currency_code         text        NOT NULL,
  refunded_at_provider  timestamptz,
  -- Evidencia + writer contract
  raw_jsonb             jsonb       NOT NULL DEFAULT '{}',
  last_occurred_at      timestamptz NOT NULL,
  last_source_event_id  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Idempotencia
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
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();;
