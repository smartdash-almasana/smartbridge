// ============================================================================
// SmartSeller V2 — Normalizer (Ingest Layer)
// Responsibility: read one v2_webhook_events row → write one v2_domain_events row.
// No clinical logic. No external API calls. No engine imports. No fire-and-forget.
// ============================================================================

import { supabaseAdmin } from '../lib/supabase';
import type { WebhookEventRow } from '../types/v2';
import { logIngestAttempt } from './ingest-attempts';

// ─── Topic → event_type / entity_type mapping ────────────────────────────────
interface TopicMapping {
    event_type: string;
    entity_type: string;
}

const TOPIC_MAP: Record<string, TopicMapping> = {
    orders_v2: { event_type: 'order.updated', entity_type: 'order' },
    payments: { event_type: 'payment.updated', entity_type: 'payment' },
    questions: { event_type: 'question.received', entity_type: 'question' },
    messages: { event_type: 'message.received', entity_type: 'message' },
};

function mapTopic(topic: string): TopicMapping {
    return TOPIC_MAP[topic] ?? { event_type: topic, entity_type: 'unknown' };
}

// ─── Entity ID extraction ─────────────────────────────────────────────────────
function extractEntityId(resource: string | null): string {
    if (!resource) return 'unknown';
    const trimmed = resource.replace(/\/$/, '');
    const last = trimmed.split('/').pop();
    return last && last.trim() !== '' ? last.trim() : resource;
}

// ─── Normalizer result ────────────────────────────────────────────────────────
export interface NormalizerResult {
    domain_event_id: string | null; // null = idempotent conflict (DO NOTHING), not an error
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function normalizeWebhookEvent(eventId: string): Promise<NormalizerResult> {
    // 1. Read the webhook event record
    const { data: webhookEvent, error: readError } = await supabaseAdmin
        .from('v2_webhook_events')
        .select('event_id, store_id, topic, resource, raw_payload, received_at')
        .eq('event_id', eventId)
        .maybeSingle<Pick<WebhookEventRow, 'event_id' | 'store_id' | 'topic' | 'resource' | 'raw_payload' | 'received_at'>>();

    if (readError) {
        throw new Error(
            `[normalizer] Failed to read webhook_event ${eventId}: ${readError.message} (code: ${readError.code})`
        );
    }

    if (!webhookEvent) {
        throw new Error(
            `[normalizer] webhook_event not found: ${eventId}`
        );
    }

    // 2. Derive classification from topic
    const { event_type, entity_type } = mapTopic(webhookEvent.topic);

    // 3. Extract entity_id from resource path
    const entity_id = extractEntityId(webhookEvent.resource ?? null);

    // 4. Derive occurred_at
    const rawPayload = webhookEvent.raw_payload as Record<string, unknown> | null;
    const occurred_at: string =
        (typeof rawPayload?.date_created === 'string' && rawPayload.date_created)
            ? rawPayload.date_created
            : new Date().toISOString();

    try {
        // 5. Insert into v2_domain_events
        // throwOnError() throws on unexpected DB errors — no need for post-check on insertError.
        // ON CONFLICT (source_event_id, event_type) DO NOTHING returns [] with no error.
        const { data: inserted } = await supabaseAdmin
            .from('v2_domain_events')
            .upsert(
                {
                    source_event_id: webhookEvent.event_id,
                    event_type,
                    entity_type,
                    entity_id,
                    occurred_at,
                    payload: rawPayload,
                },
                { onConflict: 'source_event_id', ignoreDuplicates: true }
            )
            .select('domain_event_id')
            .throwOnError();

        // If conflict → inserted is [] → domain_event_id is null (not an error)
        const domain_event_id: string | null =
            Array.isArray(inserted) && inserted.length > 0
                ? (inserted[0] as { domain_event_id: string }).domain_event_id
                : null;

        await logIngestAttempt({
            event_id: webhookEvent.event_id,
            store_id: webhookEvent.store_id,
            worker: 'normalizer',
            status: domain_event_id ? 'ok' : 'skipped',
        });

        return { domain_event_id };
    } catch (error: any) {
        await logIngestAttempt({
            event_id: webhookEvent.event_id,
            store_id: webhookEvent.store_id,
            worker: 'normalizer',
            status: 'error',
            error_message: error.message,
            error_detail: { stack: error.stack },
        });
        throw error;
    }
}
