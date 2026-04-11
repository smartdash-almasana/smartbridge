/**
 * V3 Mercado Libre Webhook Endpoint
 * Route: POST /api/v3/adapters/ml
 *
 * Entry point for Mercado Libre webhook notifications (push).
 * ML sends a POST with JSON body: { resource, user_id, topic, ... }
 *
 * Security:
 * - ML sends a notification without signature by default (App ID match).
 * - We respond with 200 immediately after writing to v3_webhook_events
 *   to prevent ML retry storms (ML retries on non-200).
 * - Writing is idempotent (dedupe_key prevents duplicates).
 *
 * ADR-0011 compliance:
 * - This route ONLY writes to v3_webhook_events via the adapter.
 * - No downstream writes (domain_events, engine, etc.) from this handler.
 */

import { adaptMeliWebhookToV3, type MeliWebhookPayload } from '@/v3/adapters/ml/webhook-adapter';

export async function POST(request: Request) {
    let rawPayload: MeliWebhookPayload;

    try {
        rawPayload = (await request.json()) as MeliWebhookPayload;
    } catch {
        // Malformed body — ML won't benefit from retry, respond 200 to avoid storm
        console.warn('[v3/ml-webhook] Malformed JSON body — ignoring');
        return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 200 });
    }

    try {
        const result = await adaptMeliWebhookToV3(rawPayload);

        console.info(
            `[v3/ml-webhook] ${result.created ? 'CREATED' : 'DUPLICATE'} ` +
            `account=${result.external_account_id} ` +
            `source=${result.identity_source} ` +
            `topic=${rawPayload.topic ?? '-'} ` +
            `webhook_event_id=${result.webhook_event_id}`
        );

        return Response.json(
            {
                ok: true,
                webhook_event_id: result.webhook_event_id,
                created: result.created,
            },
            { status: 200 }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Identity unresolvable or writer error — log, respond 200 to avoid ML retry storm
        // Unresolvable identity: store not registered in V3/V2 → legitimate drop
        // Writer error: DB connectivity — accept the loss, ML will retry
        if (message.includes('No store found')) {
            console.warn(`[v3/ml-webhook] Identity unresolvable: ${message}`);
            return Response.json({ ok: false, error: 'Store not registered' }, { status: 200 });
        }

        console.error(`[v3/ml-webhook] Adapter error: ${message}`);
        // Return 200 to suppress ML retry; operational monitoring must catch this log
        return Response.json({ ok: false, error: message }, { status: 200 });
    }
}
