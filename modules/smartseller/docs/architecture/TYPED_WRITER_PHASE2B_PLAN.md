# DB Refactor — Phase 2.B Prep: Typed Writer Plan

**Objetivo:** Diseñar la integración "Typed Writer" que consumirá `v2_domain_events` para proyectar el estado en las entidades core V1 tipadas (`v2_orders`, `v2_order_items`, `v2_payments`, `v2_refunds`, `v2_fulfillments`).

---

## 1. Inventario Actual (Worker de Ingesta)

El proceso actual (Ingest → Domain) está implementado en:
- **Worker File:** `src/v2/ingest/webhook-to-domain-worker.ts`
- **Invocación (API/Cron):** `src/app/(v2)/api/worker/v2-webhook-to-domain/route.ts`

### Puntos de anclaje identificados:
- **a) Identidad (validación):** L228 (`tenant_id: row.tenant_id ?? null`). *Nota: Tras la Phase 1.B, `tenant_id` es `NOT NULL` en DB, por lo que aquí habrá excepciones si llega nulo.* Aún no se extrae `seller_uuid` en esta capa.
- **b) Normalización (event_type):** L49-L69 `mapTopic()`. Tópicos de mercado libre como `orders_v2` se mapean a `order.updated`. `extractEntityId()` extrae el ID numérico del resource URl.
- **c) Persistencia:** L115 `dbDeps.insertDomainEvent` persiste en `v2_domain_events`.
- **d) Snapshot generation:** *GAP (UNKNOWN).* No hay generación de snapshots clínicos explícita en este worker; el flujo termina depositando en `v2_domain_events`.

### Catálogo de Event Types reales en BD
- En código: `order.updated`, `payment.updated`, `question.received`, `message.received`.
- En base de datos real: solo hay registros de `order.updated` en `v2_domain_events`.
- *GAP Contract:* No hay event types definidos/mapeados para `refund.*`, `fulfillment.*`, `order_item.*` en el worker.

---

## 2. Diseño del Typed Writer (Proyección de Estado)

El Typed Writer debe operar lógicamente como un consumidor idempotente de `v2_domain_events`.

### A) Mapeo por Event Type
- **`order.updated`**: Extraerá de `payload` financiero/logístico para realizar un **fan-out upsert** atómico a:
  - `v2_orders` (entidad base)
  - `v2_order_items` (array de ítems)
  - `v2_payments` (transactions incluidas en el JSON de ML)
  - `v2_fulfillments` (estado logístico incluido en el JSON de shipping)

### B) Estrategia de Upsert Determinista (Writer Contract)
El upsert debe resolver out-of-order execution y replays sin corrupción:
1. Buscar la tupla `(provider_key, store_id, external_id)` y comparar:
   - `INCOMING.occurred_at > CURRENT.last_occurred_at`
2. **Tie-breaker:** Si `occurred_at` es igual, usar el vector de inserción de DB como desempate determinista:
   - `INCOMING.normalized_at > CURRENT.last_occurred_at` (utilizando la columna `normalized_at` de `v2_domain_events` que está garantizada como NOT NULL).
3. **Partial Updates:** Los campos omitidos en el payload conservarán el estado previo (via `COALESCE`), mientras que la evidencia bruta real se almacena en `raw_jsonb = INCOMING.payload`.

### C) Manejo de Deletes/Cancelaciones
- **Nunca se hace DELETE físico**.
- Si un evento `order.cancelled` llega, la tabla `v2_orders` hace upsert con `order_status = 'cancelled'`, preservando `created_at` original.
- Los registros se preservan para evidencia en `raw_jsonb`.

---

## 3. Estrategia de QA y Control de Errores

### Mecanismo DLQ / Manejo de fallos (W0)
- **GAP Identificado:** Actualmente existe `v2_ingest_attempts` y `v2_webhook_ingest_jobs` para capturar errores entre webhook y domain, pero **no existe tabla de logs/errores/DLQ transaccional (W0) exclusiva para el tramo Domain → Typed Entities.**
- **Plan Mínimo:** Se deberá agregar una tabla u otro componente `v2_typed_writer_dlq` que registre excepciones de `NOT NULL`, FK mismatch o constraints en el Typed Writer, para prevenir back-pressure y habilitar replay manual.
