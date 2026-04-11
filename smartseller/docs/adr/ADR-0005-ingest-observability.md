# ADR-0005: Observabilidad del Ingest (Webhook → Domain)

- **Status:** Accepted
- **Date:** 2026-03-03
- **Autores:** Arquitecto clínico SmartSeller V2

---

## Contexto

Durante la sesión de prueba E2E del pipeline `webhook → domain → engine → score` (2026-03-03),
se documentaron los siguientes incidentes que evidencian la ausencia de trazabilidad estructurada:

| Incidente | Causa | Impacto |
|---|---|---|
| **HTTP 404 falso** (sesión anterior) | Worker no desplegado en prod | No había registro del intento fallido ni du diagnóvio |
| **HTTP 500 por ON CONFLICT** | `uq_v2_domain_events_source_type` incompatible con el código | Error propagado sin contexto del evento afectado |
| **Falta de rastreo de intentos** | `v2_webhook_events` no tiene `processed_at`, `attempts`, ni `last_error` | Imposible saber cuántos reintentos hubo, ni cuáles fallaron |
| **Deduplicación silenciosa** | El worker cuenta `deduped` en memory, no persiste evidencia | Si hay drift o bug en deduplicación, no hay auditoría |

### Estado actual del esquema (evidencia real, 2026-03-03)

**`v2_webhook_events`** — columnas actuales:
```
event_id          uuid     PK
store_id          uuid     NOT NULL, FK → v2_stores
tenant_id         uuid     nullable
provider_event_id text     NOT NULL
topic             text     NOT NULL
resource          text     nullable
provider_user_id  text     nullable
raw_payload       jsonb    nullable
received_at       timestamptz NOT NULL
dedupe_key        text     nullable (partial unique index when not null)
```
**Notorio ausente:** `processed_at`, `process_attempts`, `last_error`, `status`.

**`v2_domain_events`** — columnas actuales:
```
domain_event_id   uuid     PK
source_event_id   uuid     NOT NULL, UNIQUE, FK → v2_webhook_events(event_id)
store_id          uuid     nullable
tenant_id         uuid     nullable
event_type        text     NOT NULL
entity_type       text     NOT NULL
entity_id         text     NOT NULL
payload           jsonb    nullable
occurred_at       timestamptz nullable
normalized_at     timestamptz NOT NULL, DEFAULT now()
```

**Tablas tipo observabilidad actualmente existentes:**
```
v2_engine_runs          ← existe (para el motor de score)
worker_heartbeats       ← existe (tabla legacy/v1)
```
**No existen:** `v2_ingest_attempts`, `v2_ingest_runs`.

### Comportamiento actual del worker bajo fallo

```typescript
// webhook-to-domain-worker.ts:102-104
if (error) {
    throw new Error(`[v2-worker] insert domain event failed: ${error.message}`);
}
```
El worker lanza una excepción que la route captura y devuelve como `HTTP 500`. 
**No hay persistencia del intento fallido.** No hay reintentos. No hay DLQ.

---

## Decisión

Se crea una tabla **`v2_ingest_attempts`** append-only para registrar cada intento de
conversión de `webhook_event → domain_event`, con su resultado.

### Principios de diseño

1. **Append-only**: no se hace UPDATE sobre esta tabla. Cada intento = 1 fila nueva.
2. **FK suave sobre `event_id`**: se registra el intento incluso si el evento fue
   eliminado (FK con `ON DELETE SET NULL` para auditoría forense).
3. **No bloquea el pipeline**: el insert de `v2_ingest_attempts` es best-effort.
   Si falla el insert de auditoría, el pipeline continúa (log de advertencia en consola).
4. **`worker` como discriminador**: permite múltiples workers en el futuro
   (`v2-webhook-to-domain`, `normalizer`, `meli-sync`, etc.) sin tabla nueva.
5. **Granularidad de error**: `error_detail jsonb` preserva el stack trace o contexto
   adicional sin aumentar columnas.

### Modelo de datos: `v2_ingest_attempts`

```
attempt_id      uuid           PK, DEFAULT gen_random_uuid()
event_id        uuid           FK → v2_webhook_events(event_id) ON DELETE SET NULL, nullable
store_id        uuid           NOT NULL — desnormalizado para filtros directos sin JOIN
worker          text           NOT NULL — 'v2-webhook-to-domain' | 'normalizer' | 'meli-sync'
status          text           NOT NULL — CHECK IN ('ok', 'error', 'skipped')
error_message   text           nullable — mensaje corto del error
error_detail    jsonb          nullable — stack, contexto, input state
created_at      timestamptz    NOT NULL DEFAULT now()
```

### ¿Por qué no agregar columnas a `v2_webhook_events`?

| Opción | Pros | Cons |
|---|---|---|
| Columnas en `v2_webhook_events` (`processed_at`, `attempts`) | Acceso O(1) por evento | Muta datos de ingest; complica idempotencia; lock de UPDATE en hot path |
| Tabla `v2_ingest_attempts` (elegida) | Append-only, sin locks, auditable, multi-worker | JOIN necesario para queries de diagnóstico |

---

## Consecuencias

### Positivas
- Cada fallo queda registrado con contexto: `error_message + error_detail`.
- Deduplicación evidenciada: si el worker skippea un evento, queda registro (`status='skipped'`).
- Multi-worker ready: el campo `worker` discrimina la fuente del intento.
- DLQ lógica posible: `WHERE status = 'error' AND event_id NOT IN (SELECT source_event_id FROM v2_domain_events)`.
- Métricas de coud rate por store o por período directamente desde SQL.

### Negativas / Mitigadas
- Costo de escritura adicional por evento. **Mitigación:** INSERT best-effort (no bloquea pipeline).
- Crecimiento de tabla. **Mitigación:** índice por `store_id + created_at` permite `VACUUM`/particionado futuro.
- No hay columnas de reintentos en `v2_webhook_events`. **Mitigación:** el count de filas
  en `v2_ingest_attempts` por `event_id` es el conteo de intentos.

---

## Plan de Rollout

| Paso | Acción | Dependencia |
|---|---|---|
| 1 | Aplicar SQL migration (`v2_ingest_attempts`) | Ninguna |
| 2 | Actualizar `webhook-to-domain-worker.ts` para registrar cada intento | Step 1 |
| 3 | Actualizar `normalizer.ts` para registrar cada intento | Step 1 |
| 4 | (Opcional) Actualizar `meli/sync/route.ts` para registrar intentos por orden | Step 1 |
| 5 | Verificar con query de monitoreo que los registros se persisten correctamente | Steps 2-4 |
| 6 | Backfill opcional: registrar como `status='ok'` los `domain_events` existentes | Steps 1-5 |

---

## Queries de Monitoreo

### Q1 — Últimos errores por store (diagnóstico operativo)
```sql
SELECT
    ia.store_id,
    ia.worker,
    ia.status,
    ia.error_message,
    ia.error_detail,
    ia.created_at,
    we.provider_event_id,
    we.topic,
    we.resource
FROM public.v2_ingest_attempts ia
LEFT JOIN public.v2_webhook_events we ON we.event_id = ia.event_id
WHERE ia.store_id = '<STORE_ID>'
  AND ia.status = 'error'
ORDER BY ia.created_at DESC
LIMIT 20;
```

### Q2 — Eventos atascados (error pero sin domain_event, candidatos a DLQ)
```sql
SELECT
    ia.event_id,
    ia.store_id,
    ia.worker,
    ia.error_message,
    COUNT(*) AS attempts,
    MAX(ia.created_at) AS last_attempt_at
FROM public.v2_ingest_attempts ia
WHERE ia.status = 'error'
  AND NOT EXISTS (
      SELECT 1 FROM public.v2_domain_events de
      WHERE de.source_event_id = ia.event_id
  )
GROUP BY ia.event_id, ia.store_id, ia.worker, ia.error_message
ORDER BY last_attempt_at DESC
LIMIT 50;
```

---

## Referencias

- `src/v2/ingest/webhook-to-domain-worker.ts`
- `src/v2/ingest/normalizer.ts`
- `docs/adr/ADR-0004-domain-event-cardinality.md`
- `docs/e2e-execution-evidence.md`
- Incidentes documentados durante sesión E2E, 2026-03-03
