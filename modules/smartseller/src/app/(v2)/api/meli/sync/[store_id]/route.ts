// ============================================================================
// SmartSeller V2 — POST /api/meli/sync/[store_id]
//
// Flow:
//   1. Validate session (Supabase auth cookie)
//   2. Validate membership (user owns this store)
//   3. Load active OAuth token for store from v2_oauth_tokens
//   4. Fetch ML Orders last 14d (paginated, max 100 per page)
//   5. Per order → persist to v2_webhook_events (idempotent via dedupe_key)
//   6. Normalize to v2_domain_events (order.created / order.cancelled)
//   7. Return counts
//
// TODO (PORT_LATER):
//   - messages  → event_type: message.received / message.answered
//   - claims    → event_type: claim.opened
//   - token refresh if expires_at <= now (single-flight atomic)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@v2/lib/supabase';
import { getValidToken } from '@v2/lib/meli-token';
import { logIngestAttempt } from '@v2/ingest/ingest-attempts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncResult {
    store_id: string;
    fetched_orders: number;
    inserted_webhooks: number;
    deduped_webhooks: number;
    domain_events_by_type: Record<string, number>;
}

interface MeliOrder {
    id: number;
    status: string;
    date_created: string | null;
    date_closed: string | null;
}

function resolveMaxOrders(request: NextRequest): number {
    const raw = request.nextUrl.searchParams.get('max_orders');
    const parsed = Number(raw ?? '50');
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(200, Math.floor(parsed));
}

function resolveHistoricalMode(request: NextRequest): boolean {
    const raw = request.nextUrl.searchParams.get('historical');
    if (!raw) return false;
    return raw === '1' || raw.toLowerCase() === 'true';
}

function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function isWorkerAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    return Boolean(provided && expected && provided === expected);
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getSessionUserId(request: NextRequest): Promise<string | null> {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: () => { },
            },
        }
    );
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
}

async function getMembership(
    userId: string,
    storeId: string
): Promise<{ tenant_id: string } | null> {
    const { data } = await supabaseAdmin
        .from('v2_store_memberships')
        .select('tenant_id')
        .eq('user_id', userId)
        .eq('store_id', storeId)
        .limit(1)
        .maybeSingle<{ tenant_id: string }>();
    return data ?? null;
}

async function getStoreTenant(storeId: string): Promise<{ tenant_id: string } | null> {
    const { data } = await supabaseAdmin
        .from('v2_stores')
        .select('tenant_id')
        .eq('store_id', storeId)
        .limit(1)
        .maybeSingle<{ tenant_id: string }>();
    return data ?? null;
}

// ─── ML Orders fetcher ────────────────────────────────────────────────────────

async function fetchMeliOrders(storeId: string, maxOrders: number, historical: boolean): Promise<MeliOrder[]> {
    const accessToken = await getValidToken(storeId);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 14);
    const sinceIso = since.toISOString().slice(0, 10); // YYYY-MM-DD

    // ML Orders search: seller's own orders created since 14d ago
    // Docs: GET /orders/search?seller=<id>&order.date_created.from=<ISO>&limit=100
    // First: get seller's own ML user_id from /users/me
    const meRes = await fetch('https://api.mercadolibre.com/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
    });
    if (!meRes.ok) throw new Error(`[meli/sync] /users/me failed (${meRes.status})`);
    const meBody = await meRes.json() as { id: number };
    const sellerId = meBody.id;

    const orders: MeliOrder[] = [];
    const pageSize = 50;
    for (let offset = 0; orders.length < maxOrders; offset += pageSize) {
        const remaining = maxOrders - orders.length;
        const limit = Math.min(pageSize, remaining);
        const url = historical
            ? `https://api.mercadolibre.com/orders/search?seller=${sellerId}&limit=${limit}&offset=${offset}`
            : `https://api.mercadolibre.com/orders/search?seller=${sellerId}&order.date_created.from=${sinceIso}T00:00:00.000-00:00&limit=${limit}&offset=${offset}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`[meli/sync] orders/search failed (${res.status}): ${body.slice(0, 200)}`);
        }

        const body = await res.json() as { results: MeliOrder[] };
        const page = body.results ?? [];
        if (page.length === 0) break;
        orders.push(...page);
        if (page.length < limit) break;
    }

    return orders;
}

// ─── Persist helpers ──────────────────────────────────────────────────────────

function mapEventType(status: string): string {
    const s = status.toLowerCase();
    if (s === 'cancelled' || s === 'canceled') return 'order.cancelled';
    return 'order.created';
}

async function syncOrders(params: {
    storeId: string;
    tenantId: string;
    orders: MeliOrder[];
}): Promise<{ inserted_webhooks: number; deduped: number; domain_events_by_type: Record<string, number> }> {
    const { storeId, tenantId, orders } = params;
    let insertedWebhooks = 0;
    let deduped = 0;
    const domainCounts: Record<string, number> = {};

    for (const order of orders) {
        const providerEventId = `sync:order:${order.id}:${order.status}`;
        const dedupeKey = providerEventId; // Deterministic: store+providerEventId unique
        const fetchedAt = new Date().toISOString();

        // Step A: Persist webhook_event (idempotent)
        const { data: whRow, error: whErr } = await supabaseAdmin
            .from('v2_webhook_events')
            .upsert(
                {
                    store_id: storeId,
                    tenant_id: tenantId,
                    provider_event_id: providerEventId,
                    dedupe_key: dedupeKey,
                    topic: 'orders_v2',
                    resource: `/orders/${order.id}`,
                    raw_payload: { order, fetched_at: fetchedAt, kind: 'sync' },
                    received_at: fetchedAt,
                },
                { onConflict: 'store_id,dedupe_key', ignoreDuplicates: false }
            )
            .select('event_id')
            .maybeSingle<{ event_id: string }>();

        if (whErr) {
            console.error(`[meli/sync] webhook_event upsert failed for order ${order.id}:`, whErr.message);
            continue;
        }

        if (!whRow) {
            // Row conflict ignored = already existed = deduped
            deduped++;
            continue;
        }

        insertedWebhooks++;

        // Step B: Normalize to domain_event
        const eventType = mapEventType(order.status);
        const occurredAt = order.date_created ?? order.date_closed ?? fetchedAt;

        const { error: deErr } = await supabaseAdmin
            .from('v2_domain_events')
            .upsert(
                {
                    source_event_id: whRow.event_id,
                    store_id: storeId,
                    tenant_id: tenantId,
                    event_type: eventType,
                    entity_type: 'order',
                    entity_id: String(order.id),
                    payload: { order_status: order.status, provider_event_id: providerEventId },
                    occurred_at: occurredAt,
                    normalized_at: fetchedAt,
                },
                { onConflict: 'source_event_id', ignoreDuplicates: true }
            );

        if (deErr) {
            console.error(`[meli/sync] domain_event upsert failed for order ${order.id}:`, deErr.message);
            await logIngestAttempt({
                event_id: whRow.event_id,
                store_id: storeId,
                worker: 'meli-sync',
                status: 'error',
                error_message: deErr.message,
                error_detail: deErr,
            });
        } else {
            domainCounts[eventType] = (domainCounts[eventType] ?? 0) + 1;
            await logIngestAttempt({
                event_id: whRow.event_id,
                store_id: storeId,
                worker: 'meli-sync',
                status: 'ok',
            });
        }
    }

    return { inserted_webhooks: insertedWebhooks, deduped, domain_events_by_type: domainCounts };
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ store_id: string }> }
) {
    const { store_id } = await params;
    const maxOrders = resolveMaxOrders(request);
    const historical = resolveHistoricalMode(request);
    const workerAuth = isWorkerAuthorized(request);

    // 1-2. Auth + access check
    let tenant_id: string | null = null;
    if (workerAuth) {
        const store = await getStoreTenant(store_id);
        tenant_id = store?.tenant_id ?? null;
        if (!tenant_id) {
            return NextResponse.json({ error: 'Store not found' }, { status: 404 });
        }
    } else {
        const userId = await getSessionUserId(request);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const membership = await getMembership(userId, store_id);
        if (!membership) {
            return NextResponse.json({ error: 'Forbidden: store not accessible' }, { status: 403 });
        }
        tenant_id = membership.tenant_id;
    }
    if (!tenant_id) {
        return NextResponse.json({ error: 'Store tenant not found' }, { status: 404 });
    }

    // 3. Fetch orders from ML (token resolved internally by Token Gate)
    let orders: MeliOrder[];
    try {
        orders = await fetchMeliOrders(store_id, maxOrders, historical);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[meli/sync] ML fetch failed:', msg);
        return NextResponse.json({ error: `ML fetch failed: ${msg}` }, { status: 502 });
    }

    // 5+6. Persist + normalize
    const counts = await syncOrders({ storeId: store_id, tenantId: tenant_id, orders });

    const result: SyncResult = {
        store_id,
        fetched_orders: orders.length,
        inserted_webhooks: counts.inserted_webhooks,
        deduped_webhooks: counts.deduped,
        domain_events_by_type: counts.domain_events_by_type,
    };

    console.log('[meli/sync] done', result);
    return NextResponse.json(result, { status: 200 });
}
