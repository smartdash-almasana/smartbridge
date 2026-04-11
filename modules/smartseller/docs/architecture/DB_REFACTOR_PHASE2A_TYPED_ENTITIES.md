# DB Refactor — Phase 2.A: Entidades Tipadas Core V1

**Fecha:** 2026-03-03  
**Migración:** `supabase/migrations/20260303_12_phase2a_typed_core_entities.sql`  
**Gate antes:** 12/13 PASS (DR2 FAIL: v1_entities_missing=5)  
**Gate después:** **13/13 PASS**

---

## Contrato de Referencia

| Documento | Sección relevante |
|---|---|
| `V1_CORE_ENTITIES_SPEC.md` | Identidad obligatoria, campos por entidad, writer contract, SLA |
| `ADR_STORE_ID_AS_OPERATIONAL_UNIT.md` | Invariante UNIQUE (provider_key, store_id, external_id); seller_uuid ≠ seller_id |

**Nota de tipo:** El spec dice `tenant_id (text)` pero en DB real `v2_tenants.tenant_id` es `uuid`. Se usa `uuid` (DB como fuente de verdad real).

---

## Qué se creó

### 1. `v2_orders`
Entidad raíz del pipeline clínico. Todas las demás entidades referencian órdenes por `order_external_id`.

| Columna | Tipo | Constraint | Fuente contrato |
|---|---|---|---|
| `order_id` | uuid PK | DEFAULT gen_random_uuid() | — |
| `tenant_id` | uuid | NOT NULL FK→v2_tenants | ADR:23, Spec:12 |
| `store_id` | uuid | NOT NULL FK→v2_stores | ADR:24 |
| `seller_uuid` | uuid | NOT NULL FK→v2_sellers | ADR:25 |
| `provider_key` | text | NOT NULL | ADR:26 |
| `order_external_id` | text | NOT NULL | Spec:27 |
| `order_status` | text | NOT NULL | Spec:28 |
| `total_amount` | numeric | NOT NULL | Spec:29 |
| `currency_code` | text | NOT NULL | Spec:30 (multi-currency) |
| `created_at_provider` | timestamptz | NULL | Spec:31 |
| `closed_at_provider` | timestamptz | NULL | Spec:32 |
| `raw_jsonb` | jsonb | NOT NULL DEFAULT '{}' | Constitución §4 |
| `last_occurred_at` | timestamptz | NOT NULL | Spec:97-101 (writer contract) |
| `last_source_event_id` | text | NOT NULL | Spec:101 |

**UNIQUE:** `(provider_key, store_id, order_external_id)` — Spec:21, ADR:30  
**Índices:** `(store_id, order_status, last_occurred_at DESC)` — Spec:34; `(tenant_id, store_id)`

---

### 2. `v2_order_items`
Ítems de línea de una orden. FK lógica a `v2_orders` vía `(store_id, order_external_id)`.

| Columna clave | Constraint | Fuente |
|---|---|---|
| `order_external_id` | NOT NULL | Spec:40 |
| `line_external_id` | NOT NULL | Spec:41 |
| `quantity` | integer NOT NULL | Spec:42 |
| `unit_price_amount` + `unit_price_currency` | NOT NULL | Spec:43-44 (multi-currency) |
| `fees_amount`, `fees_currency` | NULL | Spec:45-46 |

**UNIQUE:** `(provider_key, store_id, order_external_id, line_external_id)` — Spec:48

---

### 3. `v2_fulfillments`
Estado logístico de envíos con SLA DB-enforced.

| Columna clave | Constraint | Fuente |
|---|---|---|
| `fulfillment_status` | NOT NULL | Spec:56 |
| `must_ship_by` | NULL | Spec:57 |
| `sla_status` | NOT NULL CHECK IN ('sla_unknown','sla_ok','sla_at_risk','sla_breached') | Spec:63-68 |

**Regla SLA:** `must_ship_by IS NULL → sla_status = 'sla_unknown'` (no enforced en DB — lógica del writer).  
**UNIQUE:** `(provider_key, store_id, fulfillment_external_id)`  
**Índice parcial SLA:** `(store_id, sla_status, must_ship_by) WHERE sla_status != 'sla_unknown'` — para signals clínicos.

---

### 4. `v2_payments`
Cobros. **INVARIANTE: Refund ≠ Payment** — tabla totalmente separada de `v2_refunds`.

| Columna clave | Constraint | Fuente |
|---|---|---|
| `amount` + `currency_code` | NOT NULL | Spec:76-77 (Constitución: multi-currency) |
| `order_external_id` | NULL | Spec:78 (payments sin orden válidos) |
| `payment_status` | NOT NULL | Spec:75 |

**UNIQUE:** `(provider_key, store_id, payment_external_id)`  
**Índices parciales:** separados para payments huérfanos (sin orden) y con orden.

---

### 5. `v2_refunds`
Reversiones. **INVARIANTE: Refund ≠ Payment** — semántica de reversión exclusivamente.

| Columna clave | Constraint | Fuente |
|---|---|---|
| `amount` + `currency_code` | NOT NULL | Spec:86-87 (Constitución: multi-currency) |
| `payment_external_id` | NULL | Spec:88 |
| `order_external_id` | NULL | Spec:89 |

**UNIQUE:** `(provider_key, store_id, refund_external_id)`  
**Sin mezcla con payments:** `refund_external_id` nunca coincide con `payment_external_id` — garantizado por tablas separadas.

---

## Invariantes Verificados

| Invariante | Implementación |
|---|---|
| Multi-tenant DB-enforced | `tenant_id`, `store_id`, `seller_uuid` NOT NULL + FK en las 5 tablas |
| Idempotencia fuerte | UNIQUE `(provider_key, store_id, external_id)` en cada tabla |
| Refund ≠ Payment | Tablas `v2_payments` y `v2_refunds` separadas; sin columnas compartidas de tipo |
| Multi-currency | `amount + currency_code NOT NULL` en `v2_orders`, `v2_payments`, `v2_refunds`; `unit_price_amount + currency NOT NULL` en `v2_order_items` |
| JSONB = evidencia | `raw_jsonb jsonb NOT NULL DEFAULT '{}'` en las 5 tablas |
| Writer contract | `last_occurred_at + last_source_event_id NOT NULL` en las 5 tablas |
| updated_at trigger | `trg_v2_<table>_set_updated_at` BEFORE UPDATE en las 5 tablas |
| SLA enum | `CHECK (sla_status IN (...))` en `v2_fulfillments` |

---

## QA Gate — Resultado Final

| Check | Status | Detail |
|---|---|---|
| 1–12 (todos previos) | ✅ PASS | sin regresión |
| **13.DR2.v1_typed_entities_in_db** | ✅ **PASS** | `v1_entities_missing=0` |

**13/13 PASS — Gate completamente verde.**

---

## Acción Pendiente (app code — fuera de scope DB)

> El worker de ingest debe ser actualizado para escribir en las 5 tablas tipadas  
> al procesar `order.*`, `payment.*`, `fulfillment.*`, `refund.*` events.  
> El writer contract (upsert determinístico por `last_occurred_at`) debe ser  
> implementado en la lógica de normalización.  
> **Hasta entonces, las tablas funcionan como scaffold vacío — no hay riesgo de producción.**
