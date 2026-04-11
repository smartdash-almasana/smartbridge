import { writeV3WebhookEvent } from '@/v3/ingest/webhook-writer';

interface V3WebhookRequestBody {
    tenant_id?: string;
    store_id?: string;
    provider_key?: 'mercadolibre' | 'system';
    source_event_id?: string;
    payload?: Record<string, unknown>;
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as V3WebhookRequestBody;

        const tenant_id = (body.tenant_id ?? '').trim();
        const store_id = (body.store_id ?? '').trim();
        const source_event_id = (body.source_event_id ?? '').trim();
        const provider_key = body.provider_key;
        const payload = body.payload ?? {};

        if (!tenant_id) return Response.json({ ok: false, error: 'Missing tenant_id' }, { status: 400 });
        if (!store_id) return Response.json({ ok: false, error: 'Missing store_id' }, { status: 400 });
        if (!source_event_id) return Response.json({ ok: false, error: 'Missing source_event_id' }, { status: 400 });
        if (!provider_key || !['mercadolibre', 'system'].includes(provider_key)) {
            return Response.json({ ok: false, error: 'provider_key must be mercadolibre|system for current V3 skeleton' }, { status: 400 });
        }

        const result = await writeV3WebhookEvent({
            tenant_id,
            store_id,
            provider_key,
            source_event_id,
            payload,
        });

        return Response.json({ ok: true, ...result }, { status: 200 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
