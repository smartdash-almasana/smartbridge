# Audit — V2 Worker Webhook-to-Domain Hardening

## Estrategia de filtrado de no procesados

Archivo: `src/v2/ingest/webhook-to-domain-worker.ts`

Cambios aplicados en `loadWebhookEvents`:
- Mantiene orden determinístico: `received_at ASC`.
- Mantiene límite configurable: default `50`, y route limita a máximo `200`.
- Trae candidatos y excluye los ya procesados consultando `v2_domain_events.source_event_id`.
- Devuelve solo eventos no procesados (`event_id` no presente en dominio).

Fragmento relevante:

```ts
const { data, error } = await supabaseAdmin
  .from('v2_webhook_events')
  .select('event_id, store_id, tenant_id, topic, resource, received_at, raw_payload')
  .order('received_at', { ascending: true })
  .limit(candidateLimit);

const { data: existing } = await supabaseAdmin
  .from('v2_domain_events')
  .select('source_event_id')
  .in('source_event_id', eventIds);

return rows.filter((r) => !processed.has(r.event_id)).slice(0, limit);
```

Idempotencia vigente:
- Se mantiene la protección por `UNIQUE(source_event_id)` y `upsert(... onConflict: 'source_event_id', ignoreDuplicates: true)`.

## Protección del endpoint

Archivo: `src/app/(v2)/api/worker/v2-webhook-to-domain/route.ts`

Cambios aplicados:
- Se exige header `x-cron-secret`.
- Se compara con `process.env.CRON_SECRET`.
- Si falta/no coincide: `401 Unauthorized`.
- Si coincide: ejecuta worker normalmente.

Fragmento relevante:

```ts
function isAuthorized(request: NextRequest): boolean {
  const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
  const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
  if (!provided || !expected) return false;
  return provided === expected;
}

if (!isAuthorized(request)) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

## Evidencia del test

Archivo: `tests/v2-webhook-to-domain-worker.spec.ts`

Cobertura:
1. Idempotencia en re-ejecución: primer run inserta 1, segundo run no duplica.
2. Caso adicional solicitado: evento ya existente en dominio => worker no inserta nada nuevo (simulado vía filtrado upstream y `insertCalls=0`).

Comando ejecutado:

```bash
npx playwright test tests/v2-webhook-to-domain-worker.spec.ts --reporter=line
```

Salida:

```text
Running 2 tests using 1 worker
[1/2] ... is idempotent across reruns for same source_event_id
[2/2] ... skips inserts when events are already processed (filtered upstream)
2 passed (31.4s)
```

## Estado final
**OK**
