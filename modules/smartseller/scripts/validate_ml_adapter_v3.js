/**
 * Simulación operativa del adapter ML → V3
 * Reproduce exactamente el flujo de:
 *   identity-resolver.ts → webhook-writer.ts
 * usando el SDK de Supabase con service_role key (igual que el runtime).
 */
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://bewjtoozxukypjbckcyt.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJld2p0b296eHVreXBqYmNrY3l0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTE3NjE2MywiZXhwIjoyMDg2NzUyMTYzfQ.2gP62ZRJWNRi9TWop__duw18DAzH82daCSfD3q45BXY';

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ---- identity-resolver ----
async function resolveV3MeliIdentity(externalAccountId) {
    // Step 1: v3_stores
    const { data: v3Row, error: v3Err } = await sb
        .from('v3_stores')
        .select('tenant_id, store_id')
        .eq('provider_key', 'mercadolibre')
        .eq('store_key', externalAccountId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

    if (v3Err) throw new Error(`[v3/ml-identity] v3_stores lookup failed: ${v3Err.message}`);
    if (v3Row) return { tenant_id: v3Row.tenant_id, store_id: v3Row.store_id, source: 'v3' };

    // Step 2: v2_stores bridge
    const { data: v2Row, error: v2Err } = await sb
        .from('v2_stores')
        .select('tenant_id, store_id')
        .eq('provider_key', 'mercadolibre')
        .eq('external_account_id', externalAccountId)
        .limit(1)
        .maybeSingle();

    if (v2Err) throw new Error(`[v3/ml-identity] v2_stores bridge failed: ${v2Err.message}`);
    if (v2Row) return { tenant_id: v2Row.tenant_id, store_id: v2Row.store_id, source: 'v2_bridge' };

    throw new Error(`[v3/ml-identity] No store found for ML account ${externalAccountId}`);
}

// ---- webhook-writer ----
function buildDedupeKey(provider_key, store_id, source_event_id) {
    const raw = `${provider_key}|${store_id}|${source_event_id}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

async function writeV3WebhookEvent({ tenant_id, store_id, provider_key, source_event_id, payload }) {
    const dedupe_key = buildDedupeKey(provider_key, store_id, source_event_id);

    const { data, error } = await sb
        .from('v3_webhook_events')
        .insert({ tenant_id, store_id, provider_key, source_event_id, dedupe_key, payload, processing_status: 'pending' })
        .select('webhook_event_id')
        .maybeSingle();

    if (!error && data?.webhook_event_id) {
        return { webhook_event_id: data.webhook_event_id, dedupe_key, created: true };
    }

    if (error?.code !== '23505') throw new Error(`[v3-webhook-writer] insert failed: ${error?.message}`);

    // Duplicate → lookup
    const { data: existing, error: readErr } = await sb
        .from('v3_webhook_events')
        .select('webhook_event_id')
        .eq('tenant_id', tenant_id).eq('store_id', store_id)
        .eq('provider_key', provider_key).eq('dedupe_key', dedupe_key)
        .limit(1).maybeSingle();

    if (readErr || !existing?.webhook_event_id) throw new Error(`[v3-webhook-writer] dedupe lookup failed`);
    return { webhook_event_id: existing.webhook_event_id, dedupe_key, created: false };
}

// ---- adapter ----
function deriveMeliSourceEventId(payload) {
    return `${payload.topic}:${payload.user_id}:${payload.resource}`;
}

async function adaptMeliWebhook(rawPayload) {
    const external_account_id = String(rawPayload.user_id);
    const source_event_id = deriveMeliSourceEventId(rawPayload);
    const identity = await resolveV3MeliIdentity(external_account_id);
    const result = await writeV3WebhookEvent({
        tenant_id: identity.tenant_id,
        store_id: identity.store_id,
        provider_key: 'mercadolibre',
        source_event_id,
        payload: rawPayload,
    });
    return { ...result, tenant_id: identity.tenant_id, store_id: identity.store_id, identity_source: identity.source, external_account_id, source_event_id };
}

// ---- validation ----
const ML_PAYLOAD = {
    topic: 'orders_v2',
    resource: '/orders/9900112233',
    user_id: 59925004,
    application_id: 6309731847232907,
    attempts: 1,
    sent: '2026-03-10T20:50:00.000Z',
};

async function run() {
    console.log('=== ML ADAPTER V3 — OPERATIONAL VALIDATION ===\n');
    console.log('Payload ML:', JSON.stringify(ML_PAYLOAD, null, 2), '\n');

    console.log('--- Call 1: First ingestion (expect created=true) ---');
    let r1;
    try {
        r1 = await adaptMeliWebhook(ML_PAYLOAD);
        console.log('Result:', JSON.stringify(r1, null, 2));
    } catch (e) {
        console.error('BLOCKED on call 1:', e.message);
        return;
    }

    console.log('\n--- Call 2: Re-send same payload (expect created=false, idempotency) ---');
    let r2;
    try {
        r2 = await adaptMeliWebhook(ML_PAYLOAD);
        console.log('Result:', JSON.stringify(r2, null, 2));
    } catch (e) {
        console.error('BLOCKED on call 2:', e.message);
        return;
    }

    const idempotent = !r2.created && r2.webhook_event_id === r1.webhook_event_id;
    console.log('\nIdempotency:', idempotent ? '✅ PASS' : '❌ FAIL');

    // Verify DB state
    console.log('\n--- SQL Verification ---');
    const { data: rows } = await sb
        .from('v3_webhook_events')
        .select('webhook_event_id, tenant_id, store_id, provider_key, source_event_id, dedupe_key, processing_status, received_at')
        .eq('source_event_id', r1.source_event_id)
        .eq('provider_key', 'mercadolibre');

    console.log('Rows for this source_event_id:', JSON.stringify(rows, null, 2));
    console.log('Row count (expect 1):', rows?.length ?? 0, rows?.length === 1 ? '✅' : '❌ UNEXPECTED DUPLICATE');

    // Verify no downstream writes
    const { data: domainRows } = await sb
        .from('v3_domain_events')
        .select('domain_event_id')
        .eq('source_event_id', r1.source_event_id);
    console.log('\nv3_domain_events for this event (expect 0):', domainRows?.length ?? 0, domainRows?.length === 0 ? '✅ No downstream write' : '❌ UNEXPECTED downstream write');
}

run().catch(console.error);
