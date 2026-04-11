# QA Gate — V1 Core Entities

## Objetivo

Validar integridad estructural y completitud clínica antes de merge.

---

# Validaciones Estructurales

1. Duplicados por UNIQUE key = 0
2. amount y currency_code NOT NULL en payments/refunds
3. unit_price_amount y unit_price_currency NOT NULL en order_items
4. sla_status válido en fulfillments

---

# Validaciones Clínicas (Scoped a stores activas)

1. Órdenes recientes sin fulfillment pasado umbral
2. Pagos sin order_external_id > 30min
3. Refunds sin payment_external_id cuando proveedor lo provee
4. Fulfillments con sla_status != sla_unknown y must_ship_by pasado sin actualización

---

# Guardrails de Schema

Bloquear merge si aparece:

- scenario_key
- seller_id
- meli_user_id