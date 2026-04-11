/**
 * V3 Mercado Libre Webhook Adapter
 * ADR-0011: single entry point for ML → v3_webhook_events.
 *
 * Responsibilities (and ONLY these):
 *   1. Parse the raw ML webhook payload.
 *   2. Extract external_account_id (user_id in ML terms) and source_event_id.
 *   3. Resolve canonical (tenant_id, store_id) via identity resolver.
 *   4. Call writeV3WebhookEvent — the single governed writer for v3_webhook_events.
 *
 * Prohibitions (ADR-0011 §9):
 *   - MUST NOT write to v3_domain_events or any downstream table.
 *   - MUST NOT trigger normalization or engine runs.
 *   - MUST NOT assume identity from the request body — must always resolve.
 */

import { resolveV3MeliIdentity } from './identity-resolver';
import { writeV3WebhookEvent, type WriteV3WebhookEventResult } from '@/v3/ingest/webhook-writer';

/**
 * Shape of the raw Mercado Libre webhook notification.
 * ML sends: { resource, user_id, topic, application_id, attempts, sent, received }
 * Reference: https://developers.mercadolibre.com.ar/es_ar/recibir-notificaciones
 */
export interface MeliWebhookPayload {
    resource?: string;      // e.g. "/orders/123456789"
    user_id?: number;       // the seller's ML user ID (external_account_id)
    topic?: string;         // e.g. "orders_v2", "payments", "questions"
    application_id?: number;
    attempts?: number;
    sent?: string;
    received?: string;
    [key: string]: unknown;
}

export interface MeliAdapterResult extends WriteV3WebhookEventResult {
    tenant_id: string;
    store_id: string;
    identity_source: 'v3' | 'v2_bridge';
    external_account_id: string;
    source_event_id: string;
}

/**
 * Derives a stable source_event_id from the ML payload.
 * ML doesn't send a single canonical event ID — we derive it from resource + user_id.
 * Format: {topic}:{resource} — unique per notification.
 */
function deriveMeliSourceEventId(payload: MeliWebhookPayload): string {
    const topic = (payload.topic ?? 'unknown').trim();
    const resource = (payload.resource ?? '').trim();
    const userId = String(payload.user_id ?? '');

    if (!resource || !userId) {
        throw new Error(
            '[v3/ml-adapter] Cannot derive source_event_id: missing resource or user_id in payload'
        );
    }

    // Stable, deterministic ID: topic:user_id:resource
    return `${topic}:${userId}:${resource}`;
}

/**
 * Extracts the external_account_id (ML user_id) from the payload.
 * This is the seller's ML numeric ID — used to resolve V3 identity.
 */
function extractExternalAccountId(payload: MeliWebhookPayload): string {
    const userId = payload.user_id;
    if (!userId) {
        throw new Error(
            '[v3/ml-adapter] Missing user_id in ML webhook payload — cannot resolve identity'
        );
    }
    return String(userId);
}

/**
 * Main adapter function.
 * Called by the route handler with the raw ML payload.
 */
export async function adaptMeliWebhookToV3(
    rawPayload: MeliWebhookPayload
): Promise<MeliAdapterResult> {
    // 1. Extract external identity from ML payload
    const external_account_id = extractExternalAccountId(rawPayload);
    const source_event_id = deriveMeliSourceEventId(rawPayload);

    // 2. Resolve canonical V3 identity (tenant_id, store_id)
    const identity = await resolveV3MeliIdentity(external_account_id);

    // 3. Write to v3_webhook_events via the governed writer (idempotent)
    const result = await writeV3WebhookEvent({
        tenant_id: identity.tenant_id,
        store_id: identity.store_id,
        provider_key: 'mercadolibre',
        source_event_id,
        payload: rawPayload as Record<string, unknown>,
    });

    return {
        ...result,
        tenant_id: identity.tenant_id,
        store_id: identity.store_id,
        identity_source: identity.source,
        external_account_id,
        source_event_id,
    };
}
