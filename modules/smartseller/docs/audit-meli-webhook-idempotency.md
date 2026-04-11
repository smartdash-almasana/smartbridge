# Audit — Idempotencia real en `v2_webhook_events`

## Evidencia de definición de constraints UNIQUE

Fuente en repo con DDL explícito:
- `docs/audit-meli-webhook-db.md:52`
- `docs/audit-meli-webhook-db.md:53`

Fragmentos:

```sql
CREATE UNIQUE INDEX uq_v2_webhook_events_store_dedupe ON public.v2_webhook_events USING btree (store_id, dedupe_key) WHERE (dedupe_key IS NOT NULL)
```

```sql
UNIQUE INDEX uq_v2_webhook_events_store_event ON public.v2_webhook_events USING btree (store_id, provider_event_id)
```

Nota de trazabilidad:
- En `supabase/migrations/*.sql` de este repo no aparece la creación de `v2_webhook_events` ni de esos índices.
- El texto SQL exacto disponible en el repositorio está en `docs/audit-meli-webhook-db.md`.

## Columnas que participan en unicidad

Según evidencia SQL anterior:
- Índice único 1: `(store_id, dedupe_key)` con condición `WHERE dedupe_key IS NOT NULL`.
- Índice único 2: `(store_id, provider_event_id)`.

## ¿`provider_event_id` puede repetirse con distinto `topic`?

Con la unicidad evidenciada en `(store_id, provider_event_id)`:
- Para el mismo `store_id`: **no** puede repetirse aunque cambie `topic`.
- Entre stores distintos: **sí** puede repetirse (porque `store_id` forma parte de la clave única).

Evidencia de inserción en webhook:
- `src/v2/ingest/webhook-handler.ts:95-101` inserta `provider_event_id`, `topic`, `resource`, `raw_payload`.
- No define `onConflict` en ese insert; depende de constraint/índice único de base.

## ¿Existe `dedupe_key` calculado o depende solo de `provider_event_id`?

Webhook entrante (`/api/ingest` → `handleMeliWebhook`):
- No calcula ni setea `dedupe_key` explícitamente.
- Evidencia: `src/v2/ingest/webhook-handler.ts:95-101`.

Sync ML (`/api/meli/sync/[store_id]`):
- Sí calcula `dedupeKey` y lo persiste.
- Evidencia:
  - `src/app/(v2)/api/meli/sync/[store_id]/route.ts:126`  
    `const dedupeKey = providerEventId; // Deterministic: store+providerEventId unique`
  - `src/app/(v2)/api/meli/sync/[store_id]/route.ts:137`  
    `dedupe_key: dedupeKey`
  - `src/app/(v2)/api/meli/sync/[store_id]/route.ts:143`  
    `{ onConflict: 'store_id,dedupe_key', ignoreDuplicates: false }`

## Evaluación de suficiencia para evitar doble ingestión

Evidencia de comportamiento:
- Handler de webhook declara:  
  `src/v2/ingest/webhook-handler.ts:91`  
  `Persist to v2_webhook_events (idempotent via schema UNIQUE constraint)`
- La idempotencia del webhook entrante depende de la unicidad DB sobre `provider_event_id` por `store_id` (según DDL documentado).

Conclusión auditada:
- Existe camino idempotente documentado por índices únicos.
- La robustez depende de que esos índices estén efectivamente presentes en la base desplegada (no están versionados en las migraciones visibles del repo).

## Estado
**RIESGO**
