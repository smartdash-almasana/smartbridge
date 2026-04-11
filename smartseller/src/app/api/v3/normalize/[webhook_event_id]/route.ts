import { normalizeV3WebhookEvent } from '@/v3/ingest/domain-normalizer';

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ webhook_event_id: string }> }
) {
    try {
        const { webhook_event_id } = await params;
        if (!webhook_event_id) {
            return Response.json({ ok: false, error: 'Missing webhook_event_id' }, { status: 400 });
        }

        const result = await normalizeV3WebhookEvent({ webhook_event_id });
        return Response.json({ ok: true, ...result }, { status: 200 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
