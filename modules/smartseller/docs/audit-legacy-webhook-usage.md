# Audit — Uso de tabla legacy `webhook_events` en runtime

## Referencias encontradas (ruta + fragmento)

### 1) Escritura/actualización en worker legacy
Archivo: `old/legacy-src-api/api/jobs/process-meli-webhooks/route.ts`

- `old/legacy-src-api/api/jobs/process-meli-webhooks/route.ts:49`
```ts
.from('webhook_events')
.update({ status: 'done', processed_at: new Date().toISOString(), last_error: null })
.eq('id', event.id);
```

- `old/legacy-src-api/api/jobs/process-meli-webhooks/route.ts:65`
```ts
.from('webhook_events')
.update({ status: 'failed', last_error: errorMessage, processed_at: new Date().toISOString() })
.eq('id', event.id);
```

- `old/legacy-src-api/api/jobs/process-meli-webhooks/route.ts:76`
```ts
.from('webhook_events')
.update({ status: 'pending', last_error: errorMessage })
.eq('id', event.id);
```

### 2) Lectura en endpoint clínico legacy
Archivo: `old/legacy-src-api/api/internal/meli/clinical-ui/route.ts`

- `old/legacy-src-api/api/internal/meli/clinical-ui/route.ts:310`
```ts
.from('webhook_events')
.select('resource, received_at, raw_payload')
.eq('user_id', external_id)
.in('topic', ['questions', 'claims', 'messages'])
.order('received_at', { ascending: false })
.limit(WEBHOOK_LIMIT);
```

### 3) Lectura en métricas/salud operativa legacy
Archivo: `old/legacy-src-api/api/engine/ops-health/route.ts`

- `old/legacy-src-api/api/engine/ops-health/route.ts:128`
```ts
.from("webhook_events")
.select("id", { count: "exact", head: true })
.eq("status", "dead_letter");
```

## Módulos/imports relacionados con pipeline V1 webhook

- `old/legacy-src-api/api/meli/webhook/route.ts:2`
```ts
import { storeMeliWebhookEvent } from '@/lib/services/smartseller/meli-webhook';
```

- `old/legacy-src-api/api/meli/notifications/route.ts:2`
```ts
import { storeMeliWebhookEvent } from '@/lib/services/smartseller/meli-webhook';
```

- `old/legacy-src-api/api/internal/webhook-worker/route.ts:3`
```ts
import { runWebhookWorker } from '@/lib/engine/smartseller/webhook-worker';
```

- `old/legacy-src-api/api/jobs/process-meli-webhooks/route.ts:3`
```ts
import { processWebhookEvent } from '@/lib/engine/smartseller/processor';
```

- `old/legacy-src-api/api/jobs/process-meli-webhooks/route.ts:29`
```ts
.rpc('claim_webhook_events', { batch_size: 50, worker_id: `worker-job-${Date.now()}` });
```

## Búsqueda negativa en runtime V2

Búsqueda en rutas activas V2 (`src/app/(v2)`, `src/v2`) no muestra `.from('webhook_events')`; solo aparece `v2_webhook_events`.

Evidencia:
- `src/v2/ingest/webhook-handler.ts:94` → `.from('v2_webhook_events')`
- `src/v2/ingest/normalizer.ts:44` → `.from('v2_webhook_events')`
- `src/app/(v2)/api/meli/sync/[store_id]/route.ts:131` → `.from('v2_webhook_events')`

## Clasificación lectura/escritura

- `webhook_events` (legacy):
  - Escritura/Update: sí (`old/legacy-src-api/api/jobs/process-meli-webhooks/route.ts`).
  - Lectura/Select: sí (`old/legacy-src-api/api/internal/meli/clinical-ui/route.ts`, `old/legacy-src-api/api/engine/ops-health/route.ts`).
- `v2_webhook_events` (runtime V2): uso activo en `src/v2` y `src/app/(v2)`.

## Procesos activos que dependan de `webhook_events`

Evidencia de procesos/endpoints legacy que lo usan:
- Worker de procesamiento: `old/legacy-src-api/api/jobs/process-meli-webhooks/route.ts`
- Endpoint interno webhook worker: `old/legacy-src-api/api/internal/webhook-worker/route.ts`
- Ops health (DLQ): `old/legacy-src-api/api/engine/ops-health/route.ts`
- Clinical UI legacy: `old/legacy-src-api/api/internal/meli/clinical-ui/route.ts`

## Conclusión clara
**USO PASIVO**

(Referencia encontrada exclusivamente en `old/legacy-src-api/...` dentro del repositorio actual; no se encontraron accesos a `webhook_events` en `src/app/(v2)` ni `src/v2`.)
