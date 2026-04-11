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

interface OrderRow {
    seller_uuid: string;
    provider_key: string;
    order_external_id: string;
    currency_code?: string;
}

// Extract a deterministic line_external_id for an item.
// ML includes order_item.id in each item. Fallback: sha256(sku|title|idx).
function extractLineExternalId(item: any, idx: number, orderExternalId: string): string {
    if (item?.id) return String(item.id);
    // Deterministic fallback from item content
    const raw = `${orderExternalId}|${item?.item?.id ?? ''}|${item?.item?.title ?? ''}|${idx}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

// ML order items are under order.order_items (array)
function extractItems(payload: Record<string, any>): any[] {
    const items = payload.order_items;
    if (Array.isArray(items)) return items;
    return [];
}

export async function writeOrderItemsFromOrderEvent(
    ctx: { log: (msg: string) => void },
    domainEvent: DomainEvent,
    orderRow: OrderRow
): Promise<{ inserted: number; updated: number; dlq: number }> {
    const result = { inserted: 0, updated: 0, dlq: 0 };

    if (domainEvent.event_type !== 'order.updated') return result;
    if (!domainEvent.tenant_id) {
        ctx.log('[items-writer] Skipping — missing tenant_id');
        return result;
    }

    const payload = domainEvent.payload || {};
    const items = extractItems(payload);

    // No items in payload → SKIP (not a DLQ-worthy event; payload is a raw notification)
    if (items.length === 0) return result;

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const lineExternalId = extractLineExternalId(item, idx, orderRow.order_external_id);

        try {
            // Minimum clinical fields
            const quantity = item?.quantity;
            const unitPriceAmount = item?.unit_price ?? item?.sale_fee ?? null;
            const unitPriceCurrency = item?.currency_id ?? orderRow.currency_code ?? null;

            const itemData: any = {
                tenant_id: domainEvent.tenant_id,
                store_id: domainEvent.store_id,
                seller_uuid: orderRow.seller_uuid,
                provider_key: orderRow.provider_key,
                order_external_id: orderRow.order_external_id,
                line_external_id: lineExternalId,
                quantity: quantity !== undefined ? Number(quantity) : null, // let DB reject if null
                unit_price_amount: unitPriceAmount !== null ? Number(unitPriceAmount) : null,
                unit_price_currency: unitPriceCurrency,
                raw_jsonb: item,
                last_occurred_at: domainEvent.occurred_at,
                last_source_event_id: domainEvent.source_event_id,
            };

            // Optional fees — only if present
            if (item?.sale_fee !== undefined) {
                itemData.fees_amount = Number(item.sale_fee);
                itemData.fees_currency = unitPriceCurrency;
            }

            const { error: upsertErr } = await supabaseAdmin
                .from('v2_order_items')
                .upsert(itemData, {
                    onConflict: 'provider_key, store_id, order_external_id, line_external_id',
                    ignoreDuplicates: false,
                });

            if (upsertErr) {
                throw new Error(`DB Error: ${upsertErr.message} (Code: ${upsertErr.code})`);
            }

            result.inserted += 1;
        } catch (error: any) {
            ctx.log(`[items-writer] DLQ for item idx=${idx} of order ${orderRow.order_external_id}: ${error.message}`);
            await sendItemToDlq(domainEvent, error, orderRow.provider_key, orderRow.order_external_id, lineExternalId);
            result.dlq += 1;
        }
    }

    return result;
}

async function sendItemToDlq(
    domainEvent: DomainEvent,
    error: any,
    providerKey: string,
    orderExternalId: string,
    itemExternalId: string,
) {
    const error_code = error.code || 'VALIDATION_ERROR';
    const error_detail = error.message || String(error);

    // Deterministic dedupe_key per item per domain event
    const dedupe_raw = `${domainEvent.tenant_id || 'null'}|${domainEvent.store_id}|${providerKey}|${domainEvent.event_type}|${orderExternalId}|${itemExternalId}|${domainEvent.domain_event_id}`;
    const dedupe_key = crypto.createHash('sha256').update(dedupe_raw).digest('hex');

    const { error: dlqErr } = await supabaseAdmin
        .from('v2_dlq_events')
        .upsert({
            tenant_id: domainEvent.tenant_id,
            store_id: domainEvent.store_id,
            provider_key: providerKey,
            source: 'typed_writer_items',
            event_type: domainEvent.event_type,
            external_id: `${orderExternalId}:${itemExternalId}`,
            dedupe_key,
            raw_event: domainEvent.payload || {},
            error_code: String(error_code).substring(0, 50),
            error_detail,
        }, { onConflict: 'dedupe_key', ignoreDuplicates: true });

    if (dlqErr) {
        console.error(`[items-writer/DLQ] Failed to write DLQ entry: ${dlqErr.message}`);
    }
}
