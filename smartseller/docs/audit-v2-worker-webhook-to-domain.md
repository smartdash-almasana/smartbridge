# Audit — V2 Worker `v2_webhook_events -> v2_domain_events`

## Esquema utilizado

### `v2_webhook_events`
Fuente: `supabase/migrations/20260302_v2_webhook_events.sql`

Columnas usadas por el worker:
- `event_id`
- `store_id`
- `tenant_id`
- `topic`
- `resource`
- `received_at`
- `raw_payload`

### `v2_domain_events`
Columnas pobladas por el worker:
- `source_event_id` (desde `v2_webhook_events.event_id`)
- `store_id`
- `tenant_id`
- `event_type` (derivado de `topic`)
- `entity_type` (mínimo viable)
- `entity_id` (derivado de `resource`)
- `occurred_at` (=`received_at`)
- `payload` (=`raw_payload`)

Fuente de evidencia de escritura:
- `src/v2/ingest/webhook-to-domain-worker.ts`

## Estrategia de idempotencia

1. Se agregó índice único en dominio:
- `supabase/migrations/20260302_v2_domain_events_source_event_unique.sql`

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_domain_events_source_event
  ON public.v2_domain_events (source_event_id)
  WHERE source_event_id IS NOT NULL;
```

2. El worker inserta con `ON CONFLICT DO NOTHING` vía Supabase:

```ts
.upsert(event, { onConflict: 'source_event_id', ignoreDuplicates: true })
```

3. Resultado:
- Re-ejecutable sin duplicar por `source_event_id`.
- Determinístico para la misma entrada.

## Archivos creados/modificados

- `src/v2/ingest/webhook-to-domain-worker.ts` (nuevo)
- `src/app/(v2)/api/worker/v2-webhook-to-domain/route.ts` (nuevo)
- `supabase/migrations/20260302_v2_domain_events_source_event_unique.sql` (nuevo)
- `tests/v2-webhook-to-domain-worker.spec.ts` (nuevo)

## Cómo ejecutar el worker

### HTTP
- `GET /api/worker/v2-webhook-to-domain`
- `POST /api/worker/v2-webhook-to-domain`
- Query opcional: `?limit=50` (máximo 200)

Respuesta:
```json
{
  "scanned": 0,
  "inserted": 0,
  "deduped": 0
}
```

### Test mínimo
Comando:
```bash
npx playwright test tests/v2-webhook-to-domain-worker.spec.ts --reporter=line
```

## Evidencia del test

Salida observada:
```text
Running 1 test using 1 worker
[1/1] tests\v2-webhook-to-domain-worker.spec.ts:9:7 › v2 webhook->domain worker › is idempotent across reruns for same source_event_id
1 passed (36.2s)
```

Validación cubierta:
- Primera ejecución: crea exactamente 1 registro de dominio.
- Segunda ejecución: no duplica (`inserted=0`, `deduped=1`).

## Estado final
**OK**
