import { normalizeWebhookEvent } from '@v2/ingest/normalizer';

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ event_id: string }> }
) {
    const { event_id } = await params;

    if (!event_id) {
        return Response.json({ error: 'Missing event_id' }, { status: 400 });
    }

    try {
        const result = await normalizeWebhookEvent(event_id);
        return Response.json(result, { status: 200 });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('not found')) {
            return Response.json({ error: message }, { status: 404 });
        }
        console.error('[POST /api/normalize]', message);
        return Response.json({ error: 'Normalization failed' }, { status: 500 });
    }
}
