# Auditoría de Robustez de Base de Datos - SmartSeller V2
**ID:** ag-sonnet-db-robustness-audit-final
**Fecha:** 2026-03-03
**Estatus Final:** NOT READY (Riesgo en Integridad y Multi-tenancy)

---

## A) Estado Actual (Repo vs DB Real)

| Entidad | En Repo (migrations) | En DB Real (Supabase) | Observaciones |
| :--- | :--- | :--- | :--- |
| `v2_stores` | PARCIAL (fixes only) | ✅ PRESENTE | El CREATE original no está en `supabase/migrations`. |
| `v2_sellers` | ❌ MISSING | ✅ PRESENTE | Tabla detectada en DB pero sin DDL en repo. |
| `v2_domain_events` | PARCIAL (index only) | ✅ PRESENTE | Sin CREATE original. Idempotencia presente por unique index. |
| `v2_snapshots` | ❌ MISSING | ✅ PRESENTE | Sin CREATE original. |
| `v2_orders` | ❌ MISSING | ❌ MISSING | Definida en `V1_CORE_ENTITIES_SPEC.md` pero no implementada. |
| `v2_payments` | ❌ MISSING | ❌ MISSING | Definida en `V1_CORE_ENTITIES_SPEC.md` pero no implementada. |
| `v2_fulfillments` | ❌ MISSING | ❌ MISSING | Definida en `V1_CORE_ENTITIES_SPEC.md` pero no implementada. |

**Evidencia Repo:**
- `v2_domain_events` missing CREATE: [ROADMAP_V1_3X_NORMALIZATION_RUNTIME_AUDIT.md:5](file:///e:/BuenosPasos/smartseller-v2/docs/architecture/ROADMAP_V1_3X_NORMALIZATION_RUNTIME_AUDIT.md#L5)
- `v2_stores` display_name fix: [20260224_v2_auth.sql:47](file:///e:/BuenosPasos/smartseller-v2/supabase/migrations/20260224_v2_auth.sql#L47)

---

## B) Checklist de Robustez Clínico

### 1. Identidad Multi-tenant: [ FAIL ]
- [x] Columnas `tenant_id` y `store_id` presentes en todas las tablas `v2_`.
- [ ] **FAIL**: `v2_domain_events` permite NULLs en `tenant_id` y `store_id`. Riesgo de orfandad de datos.
- [x] FK `v2_stores -> v2_sellers` existe y es correcta.

### 2. Idempotencia: [ PASS ]
- [x] INDEX UNIQUE `uq_v2_domain_events_source_event_id` existe.
- [x] UNIQUE compuesto en `v2_stores` (tenant, provider, external_id).

### 3. Integridad Estructural: [ FAIL ]
- [ ] **FAIL**: Las tablas financieras especificadas en `V1_CORE_ENTITIES_SPEC.md` (orders, payments, etc.) no existen en la DB. Los datos viven exclusivamente en JSONB.
- [ ] **FAIL**: Missing `updated_at` triggers en `v2_stores`, `v2_oauth_tokens` y `v2_domain_events`. Solo `sellers` (v0) tiene trigger.
- [x] SLA CHECK constraint: No aplica (sin tabla fulfillments).

### 4. Índices Críticos: [ PASS ]
- [x] `idx_v2_domain_events_occurred_at` (DESC) presente para queries de tiempo.
- [x] `idx_v2_domain_events_entity` para búsquedas focalizadas.

### 5. Determinismo Writer: [ FAIL ]
- [ ] El sistema actual no tiene un tie-breaker determinístico basado en `ingested_at` o secuencia monotónica para los domain events (usa UUID v4).

### 6. QA Gates: [ PASS ]
- [x] `docs/qa/QA_AUTOMATION_SYSTEM.sql` implementado. Detecta orfandad y duplicados.
- [x] Los checks filtran por stores activas.

---

## C) Lista Priorizada de Acciones

### P0 – Bloqueantes (Integridad de Datos)
1. **DML Reparación**: Ejecutar migración para establecer `NOT NULL` en `v2_domain_events.tenant_id` y `v2_domain_events.store_id`.
2. **Missing Tables**: Implementar DDL para `v2_orders`, `v2_payments` y `v2_fulfillments` según especificación para sacar el motor clínico del "limbo JSONB".
3. **Reconstrucción Repo**: Generar archivo `supabase/migrations/00000000_v2_core_baseline.sql` con los CREATE TABLE reales de la DB para evitar drift futuro.

### P1 – Riesgos (Observabilidad/SLA)
1. **Triggers**: Añadir triggers de `updated_at` a todas las tablas V2 para auditoría de sincronización.
2. **Tie-breaker**: Renombrar o añadir `normalized_at` como criterio de desempate monotónico en la ingesta.

---

## D) Dictamen Final

**NOT READY**

El sistema opera actualmente sobre una "sombra" de eventos sin respaldo estructural robusto. Mientras `v2_domain_events` permita NULLs en las llaves de identidad (`tenant_id`/`store_id`) y las entidades de negocio vivan solo dentro de payloads sin tipar (JSONB), el SmartSeller no garantiza protección patrimonial ni silencio clínico confiable. Se requiere la ejecución de las acciones P0 para alcanzar estatus **READY**.
