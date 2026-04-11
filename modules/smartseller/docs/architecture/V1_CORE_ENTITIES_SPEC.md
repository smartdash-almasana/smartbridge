# SmartSeller V1 — Core Entities Spec (Modelo Clínico por Tienda)

## Objetivo

Persistir objetos reales del negocio de Mercado Libre como entidades estructuradas,
manteniendo arquitectura event-driven y garantizando determinismo clínico.

---

# Identidad Obligatoria (todas las tablas v2_*)

- tenant_id (text, NOT NULL)
- store_id (uuid, NOT NULL)
- seller_uuid (uuid, NOT NULL)
- provider_key (text, NOT NULL)
- raw_jsonb (jsonb, NOT NULL)
- last_occurred_at (timestamptz, NOT NULL)
- last_source_event_id (text, NOT NULL)

Idempotencia:
UNIQUE(provider_key, store_id, external_id)

---

# 1) v2_orders

- order_external_id (text, NOT NULL)
- order_status (text, NOT NULL)
- total_amount (numeric, NOT NULL)
- currency_code (text, NOT NULL)
- created_at_provider (timestamptz)
- closed_at_provider (timestamptz NULL)

INDEX(store_id, order_status, last_occurred_at DESC)

---

# 2) v2_order_items

- order_external_id (text, NOT NULL)
- line_external_id (text, NOT NULL)
- quantity (integer, NOT NULL)
- unit_price_amount (numeric, NOT NULL)
- unit_price_currency (text, NOT NULL)
- fees_amount (numeric NULL)
- fees_currency (text NULL)

UNIQUE(provider_key, store_id, order_external_id, line_external_id)

---

# 3) v2_fulfillments

- fulfillment_external_id (text, NOT NULL)
- order_external_id (text, NOT NULL)
- fulfillment_status (text, NOT NULL)
- must_ship_by (timestamptz NULL)
- shipped_at_provider (timestamptz NULL)
- delivered_at_provider (timestamptz NULL)
- location_external_id (text NULL)

SLA:
- sla_status (text, NOT NULL)
  Values:
  - sla_unknown
  - sla_ok
  - sla_at_risk
  - sla_breached

---

# 4) v2_payments

- payment_external_id (text, NOT NULL)
- payment_status (text, NOT NULL)
- amount (numeric, NOT NULL)
- currency_code (text, NOT NULL)
- order_external_id (text NULL)
- paid_at_provider (timestamptz NULL)

---

# 5) v2_refunds

- refund_external_id (text, NOT NULL)
- amount (numeric, NOT NULL)
- currency_code (text, NOT NULL)
- payment_external_id (text NULL)
- order_external_id (text NULL)
- refunded_at_provider (timestamptz NULL)

---

# Writer Contract

Upsert determinístico:

Actualizar solo si:
- excluded.last_occurred_at > current.last_occurred_at
OR
- igualdad + excluded.last_source_event_id > current.last_source_event_id

Campos tardíos permitidos según matriz de completitud mínima.

SLA:
- Si must_ship_by NULL → sla_status = 'sla_unknown'
- Señales SLA solo si sla_status != 'sla_unknown'