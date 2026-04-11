# Auditoría Base de Datos: Webhooks de Mercado Libre (SmartSeller V2)

## 1. ¿Existe tabla `webhook_events`?
**Sí.** Existen dos tablas activas coexistiendo en el esquema `public`: 
- `webhook_events` (usada en la versión v1 / legacy engine).
- **`v2_webhook_events`** (usada activamente en la v2).

## 2. Mostrar estructura SQL completa
**Estructura de `v2_webhook_events`:**
```sql
CREATE TABLE public.v2_webhook_events (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES v2_stores(store_id),
    provider_event_id text NOT NULL,
    topic text NOT NULL,
    resource text,
    provider_user_id text,
    raw_payload jsonb,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid,
    dedupe_key text
);
```

**Estructura de `webhook_events` (V1):**
```sql
CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    provider_seller_id text,
    topic text NOT NULL,
    resource text,
    raw_payload jsonb,
    user_id text,
    status text DEFAULT 'pending'::text NOT NULL CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'done'::text, 'failed'::text, 'dead_letter'::text])),
    attempts integer DEFAULT 0 NOT NULL CHECK (attempts >= 0),
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    next_eligible_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by text,
    processed_at timestamp with time zone,
    last_error text,
    last_error_class text
);
```

## 3. ¿Existe UNIQUE constraint para dedupe?
**Sí.** Se maneja explícitamente tanto a nivel de `provider_event_id` como de clave calculada de deduplicación:

En **`v2_webhook_events`**:
- `CREATE UNIQUE INDEX uq_v2_webhook_events_store_dedupe ON public.v2_webhook_events USING btree (store_id, dedupe_key) WHERE (dedupe_key IS NOT NULL)`
- `UNIQUE INDEX uq_v2_webhook_events_store_event ON public.v2_webhook_events USING btree (store_id, provider_event_id)` *(Constricción única en base a provider ID por tienda)*. 

En **`webhook_events` (V1)**:
- `UNIQUE INDEX uq_webhook_events_provider_event ON public.webhook_events USING btree (provider, provider_event_id)`

## 4. ¿Existen índices sobre status o received_at?
**Sí.**
En **`v2_webhook_events`**:
- No existe columna `status` en V2, pero existe un índice para ordenar cronológicamente por tienda:
  - `idx_v2_webhook_events_received_at` bajo `(store_id, received_at DESC)`

En **`webhook_events` (V1)**:
- Numerosos índices para ensobrado y estado, destacando:
  - `idx_webhook_events_status_received` bajo `(status, received_at DESC)`
  - `idx_webhook_events_status` bajo `(status)`

## 5. ¿Existe tabla dead_letter o similar?
**No existe una tabla exclusiva separada** (DQT). Sin embargo, el almacenamiento de "veneno" o fallos insálvables se resuelve directamente en la columna `status` como enumeración de dominio.

En `webhook_events` (V1) existe un valor de constraint sobre `status` llamado `'dead_letter'`, respaldado por un índice parcial de búsqueda ultra-rápida:
- `ix_webhook_events_dead_letter` sobre `(id) WHERE (status = 'dead_letter'::text)`

*(Nota: En V2, dado que `v2_webhook_events` opera de forma estricta almacenando logs crudos de ingesta, el concepto de status / DLQ fue desplazado hacia la cola de dominio / events normalizados que procesa el pipeline interno).*

## 6. Últimos Registros (Evidencia)
En `v2_webhook_events` tenemos el siguiente registro capturado de una ingesta de prueba/sincronización reciente (`2026-02-26`):

```json
[
  {
    "event_id": "d3db2be7-0048-4145-a080-0d451d862c6a",
    "store_id": "0485e5e6-5bc9-4e85-bdbe-e0c9ff20a0e2",
    "provider_event_id": "/orders/v1/orders/123456",
    "topic": "orders_v2",
    "resource": "/orders/v1/orders/123456",
    "provider_user_id": "59925004",
    "raw_payload": {
      "topic": "orders_v2",
      "user_id": "59925004",
      "resource": "/orders/v1/orders/123456"
    },
    "received_at": "2026-02-26T16:09:59.135703+00:00",
    "tenant_id": "fddb3c92-e118-4d85-8824-6185fe02f55c",
    "dedupe_key": "816098858814149c1489418aa6b6e703d24c262811cf550a7edff220a9387908"
  }
]
```
*(No listamos los 10 porque solo existe 1 actualmente en la capa V2).*
