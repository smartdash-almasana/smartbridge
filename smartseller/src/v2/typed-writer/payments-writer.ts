import { supabaseAdmin } from '../lib/supabase';
import crypto from 'crypto';

interface DomainEvent {
    domain_event_id: string;
    source_event_id: string;
    store_id: string;
    tenant_id?: string | null;
    event_type: string;
    entity_id: string;
    occurred_at: string;
    payload: Record<string, any> | null;
}

export async function writePaymentFromDomainEvent(
    ctx: { log: (msg: string) => void },
    domainEvent: DomainEvent
): Promise<{ inserted: number; updated: number; dlq: number }> {
    const result = { inserted: 0, updated: 0, dlq: 0 };

    if (domainEvent.event_type !== 'payment.updated') {
        return result;
    }

    let resolvedProviderKey = 'unknown';

    try {
        if (!domainEvent.tenant_id) {
            throw new Error('NULL tenant_id in domain event');
        }

        const { data: store, error: errStore } = await supabaseAdmin
            .from('v2_stores')
            .select('seller_uuid, provider_key')
            .eq('store_id', domainEvent.store_id)
            .single();

        if (errStore || !store) {
            throw new Error(`Store not found or no identity: ${errStore?.message}`);
        }

        resolvedProviderKey = store.provider_key;
        const payload = domainEvent.payload || {};

        const paymentData: any = {
            tenant_id: domainEvent.tenant_id,
            store_id: domainEvent.store_id,
            seller_uuid: store.seller_uuid,
            provider_key: store.provider_key,
            payment_external_id: domainEvent.entity_id,
            raw_jsonb: payload,
            last_occurred_at: domainEvent.occurred_at,
            last_source_event_id: domainEvent.source_event_id
        };

        if (payload.order_id) paymentData.order_external_id = String(payload.order_id);
        if (payload.status) paymentData.payment_status = String(payload.status);
        if (payload.transaction_amount !== undefined) paymentData.amount = Number(payload.transaction_amount);
        if (payload.currency_id) paymentData.currency_code = String(payload.currency_id);
        if (payload.date_approved) paymentData.paid_at_provider = new Date(payload.date_approved as string).toISOString();

        const { error: upsertErr } = await supabaseAdmin
            .from('v2_payments')
            .upsert(paymentData, {
                onConflict: 'provider_key, store_id, payment_external_id',
                ignoreDuplicates: false
            });

        if (upsertErr) {
            throw new Error(`DB Error: ${upsertErr.message} (Code: ${upsertErr.code})`);
        }

        result.inserted += 1;

    } catch (error: any) {
        ctx.log(`[DLQ] Sending payment event ${domainEvent.domain_event_id} to DLQ. Error: ${error.message}`);
        await sendToDlq(domainEvent, error, 'typed_writer_payments', resolvedProviderKey);
        result.dlq += 1;
    }

    return result;
}

async function sendToDlq(domainEvent: DomainEvent, error: any, source: string, providerKey: string) {
    const error_code = error.code || 'VALIDATION_ERROR';
    const error_detail = error.message || String(error);

    const dedupe_raw = `${domainEvent.tenant_id || 'null'}|${domainEvent.store_id}|${providerKey}|${domainEvent.event_type}|${domainEvent.entity_id}|${domainEvent.domain_event_id}`;
    const dedupe_key = crypto.createHash('sha256').update(dedupe_raw).digest('hex');

    const dlqPayload = {
        tenant_id: domainEvent.tenant_id,
        store_id: domainEvent.store_id,
        provider_key: providerKey,
        source,
        event_type: domainEvent.event_type,
        external_id: domainEvent.entity_id,
        dedupe_key,
        raw_event: domainEvent.payload || {},
        error_code: String(error_code).substring(0, 50),
        error_detail
    };

    const { error: dlqErr } = await supabaseAdmin
        .from('v2_dlq_events')
        .upsert(dlqPayload, { onConflict: 'dedupe_key', ignoreDuplicates: true });

    if (dlqErr) {
        console.error(`[DLQ] Failed to write payment DLQ entry: ${dlqErr.message}`);
    }
}
