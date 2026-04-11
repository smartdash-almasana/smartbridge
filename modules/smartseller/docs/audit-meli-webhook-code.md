# Audit — Mercado Libre Webhook (Código)

## Rutas de archivos
- `src/app/(v2)/api/meli/webhook/route.ts`
- `src/app/(v2)/api/ingest/route.ts`
- `src/v2/ingest/webhook-handler.ts`
- Referencia de comparación (no endpoint webhook entrante): `src/app/(v2)/api/meli/sync/[store_id]/route.ts`

## Evidencia (fragmentos relevantes)

### 1) Endpoint tipo `/api/webhooks/ml` o similar
Archivo:
`src/app/(v2)/api/meli/webhook/route.ts`

```ts
// ALIAS para Meli Webhook (evitar 404)
// Redirige al handler real en api/ingest
export { POST } from '../../ingest/route';
```

Evidencia adicional de handler real:
`src/app/(v2)/api/ingest/route.ts`

```ts
export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const result = await handleMeliWebhook(body);
    return Response.json(result.body, { status: result.status });
}
```

### 2) Si guarda payload crudo
Archivo:
`src/v2/ingest/webhook-handler.ts`

```ts
await supabaseAdmin
    .from('v2_webhook_events')
    .insert({
        store_id: store.store_id,
        provider_event_id: payload.resource,
        topic: payload.topic,
        resource: payload.resource,
        provider_user_id: externalAccountId,
        raw_payload: rawPayload as Record<string, unknown>,
    })
    .throwOnError();
```

### 3) Si ejecuta lógica pesada dentro del request
Archivo:
`src/v2/ingest/webhook-handler.ts`

```ts
// Responsibility: receive, validate, persist. Nothing else.
// No clinical logic. No ML API calls. No normalization. No fire-and-forget.
```

Código ejecutado en request:
- validación de payload (`validate`)
- lookup de store en DB (`v2_stores`)
- insert en `v2_webhook_events`

No hay llamadas `fetch(...)` a APIs externas en este handler.

### 4) Cómo responde (status code)
Archivo:
`src/v2/ingest/webhook-handler.ts`

```ts
interface HandlerResult {
    status: 200 | 404 | 422 | 500;
    body: Record<string, unknown>;
}
```

```ts
if (err instanceof ValidationError) {
    return { status: 422, body: { error: err.message } };
}
```

```ts
if (storeError) {
    return { status: 500, body: { error: 'Store lookup failed' } };
}
```

```ts
if (!store) {
    return {
        status: 404,
        body: { error: 'No store found for provider=mercadolibre', external_account_id: externalAccountId },
    };
}
```

```ts
return { status: 200, body: { ok: true } };
```

### 5) Si construye `dedupe_key`
En endpoint webhook (`api/ingest` + `webhook-handler`) no aparece `dedupe_key` en el insert mostrado.

Evidencia de `dedupe_key` en otra ruta (`sync`, no webhook entrante):
`src/app/(v2)/api/meli/sync/[store_id]/route.ts`

```ts
dedupe_key: dedupeKey,
{ onConflict: 'store_id,dedupe_key', ignoreDuplicates: false }
```

## Riesgo arquitectónico
- El webhook entrante persiste `provider_event_id` y `raw_payload`, pero en el código auditado no se observa construcción explícita de `dedupe_key` en `handleMeliWebhook`.
- El comentario indica idempotencia por constraint de esquema:

```ts
// Persist to v2_webhook_events (idempotent via schema UNIQUE constraint)
```

## Estado
**RIESGO**
