import { handleMeliWebhook } from '@v2/ingest/webhook-handler';
import type { NextRequest } from 'next/server';

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
