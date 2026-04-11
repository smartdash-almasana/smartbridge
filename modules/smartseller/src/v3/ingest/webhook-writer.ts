import crypto from 'crypto';
import { supabaseAdmin } from '@v2/lib/supabase';

export type V3ProviderKey = 'mercadolibre' | 'system';

export interface WriteV3WebhookEventInput {
    tenant_id: string;
    store_id: string;
    provider_key: V3ProviderKey;
    source_event_id: string;
    payload: Record<string, unknown>;
}

export interface WriteV3WebhookEventResult {
    webhook_event_id: string;
    dedupe_key: string;
    created: boolean;
}

export function buildV3WebhookDedupeKey(input: {
    provider_key: V3ProviderKey;
    store_id: string;
    source_event_id: string;
}): string {
    const raw = `${input.provider_key}|${input.store_id}|${input.source_event_id}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function writeV3WebhookEvent(input: WriteV3WebhookEventInput): Promise<WriteV3WebhookEventResult> {
    const { tenant_id, store_id, provider_key, source_event_id, payload } = input;
    const dedupe_key = buildV3WebhookDedupeKey({ provider_key, store_id, source_event_id });

    const { data, error } = await supabaseAdmin
        .from('v3_webhook_events')
        .insert({
            tenant_id,
            store_id,
            provider_key,
            source_event_id,
            dedupe_key,
            payload,
            processing_status: 'pending',
        })
        .select('webhook_event_id')
        .maybeSingle<{ webhook_event_id: string }>();

    if (!error && data?.webhook_event_id) {
        return {
            webhook_event_id: data.webhook_event_id,
            dedupe_key,
            created: true,
        };
    }

    if (error?.code !== '23505') {
        throw new Error(`[v3-webhook-writer] insert failed: ${error?.message ?? 'unknown error'}`);
    }

    const { data: existing, error: readErr } = await supabaseAdmin
        .from('v3_webhook_events')
        .select('webhook_event_id')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('provider_key', provider_key)
        .eq('dedupe_key', dedupe_key)
        .limit(1)
        .maybeSingle<{ webhook_event_id: string }>();

    if (readErr || !existing?.webhook_event_id) {
        throw new Error(`[v3-webhook-writer] dedupe lookup failed: ${readErr?.message ?? 'missing row after conflict'}`);
    }

    return {
        webhook_event_id: existing.webhook_event_id,
        dedupe_key,
        created: false,
    };
}
