import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@v2/lib/supabase';
import { getValidToken, ReauthorizationRequired } from '@v2/lib/meli-token';
import { writeOrderFromDomainEvent } from '@/v2/typed-writer/orders-writer';
import crypto from 'crypto';

// ─── Auth ─────────────────────────────────────────────────────────────────────
function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}
function isAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    return Boolean(provided && expected && provided === expected);
}
function parseLimit(value: string | null): number {
    const n = Number(value ?? '50');
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(Math.floor(n), 200);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const WORKER_NAME = 'meli-reconcile';
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;
const DLQ_THRESHOLD = 10;
// Cursor-resume interval: if more pages remain, schedule next run in 10 min
const CURSOR_RESUME_MS = 10 * 60_000;
// Max pages per job execution (avoid serverless timeouts)
const MAX_PAGES_PER_RUN = 5;
const PAGE_SIZE = 50;

// ─── Backoff ──────────────────────────────────────────────────────────────────
function computeBackoffMs(attempts: number): number {
    const base = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts), BACKOFF_CAP_MS);
    const jitter = base * 0.1 * (Math.random() * 2 - 1);
    return Math.round(base + jitter);
}

// ─── ML API helpers ───────────────────────────────────────────────────────────
interface MeliOrder {
    id: number;
    date_last_updated: string;
    status: string;
    [key: string]: unknown;
}

interface MeliOrdersPage {
    results: MeliOrder[];
    paging: { total: number; offset: number; limit: number };
}

async function fetchOrdersPage(
    accessToken: string,
    sellerId: string,
    offset: number
): Promise<MeliOrdersPage> {
    const url = new URL('https://api.mercadolibre.com/orders/search');
    url.searchParams.set('seller', sellerId);
    url.searchParams.set('sort', 'date_asc');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(PAGE_SIZE));

    const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 401) throw new ReauthorizationRequired('unknown');
        throw new Error(`[meli-reconcile] ML orders fetch failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }

    return res.json() as Promise<MeliOrdersPage>;
}

// ─── Domain event upsert ──────────────────────────────────────────────────────
async function upsertDomainEvent(
    tenantId: string,
    storeId: string,
    order: MeliOrder
): Promise<boolean> {
    const fetchedAt = new Date().toISOString();
    const providerEventId = `reconcile:orders:${order.id}:${order.date_last_updated || fetchedAt}`;

    // ── Fix A (applied at import) + Fix B: resolve existing webhook_event when idempotent ──
    // Upsert webhook_event. On conflict (already existed), Supabase returns null with ignoreDuplicates.
    // Instead of early-returning, we always resolve the event_id to continue downstream.
    let webhookEventId: string | null = null;

    const { data: whRow, error: whErr } = await supabaseAdmin
        .from('v2_webhook_events')
        .upsert(
            {
                store_id: storeId,
                tenant_id: tenantId,
                provider_event_id: providerEventId,
                topic: 'orders_v2',
                resource: `/orders/${order.id}`,
                raw_payload: { order, fetched_at: fetchedAt, kind: 'reconcile' },
                received_at: fetchedAt,
            },
            { onConflict: 'store_id,provider_event_id' }
        )
        .select('event_id')
        .maybeSingle<{ event_id: string }>();

    if (whErr) throw new Error(`[meli-reconcile] upsert webhook event failed: ${whErr.message}`);

    if (whRow) {
        // Newly inserted
        webhookEventId = whRow.event_id;
    } else {
        // Fix B: already existed — resolve the existing event_id so we can still invoke typed writer
        const { data: existing, error: existErr } = await supabaseAdmin
            .from('v2_webhook_events')
            .select('event_id')
            .eq('store_id', storeId)
            .eq('provider_event_id', providerEventId)
            .maybeSingle<{ event_id: string }>();

        if (existErr) throw new Error(`[meli-reconcile] lookup existing webhook event failed: ${existErr.message}`);
        webhookEventId = existing?.event_id ?? null;
    }

    // If we can't resolve a webhook_event_id, skip this order (defensive)
    if (!webhookEventId) return false;

    const eventPayload = {
        source_event_id: webhookEventId,
        tenant_id: tenantId,
        store_id: storeId,
        event_type: 'order.reconciled',
        entity_type: 'order',
        entity_id: String(order.id),
        occurred_at: order.date_last_updated || fetchedAt,
        payload: order as Record<string, unknown>,
    };

    // Upsert domain_event — ignoreDuplicates=false so we always get back the domain_event_id
    // whether newly inserted or already existing (ON CONFLICT DO UPDATE with a no-op touch).
    const { data: deRow, error: deErr } = await supabaseAdmin
        .from('v2_domain_events')
        .upsert(
            eventPayload,
            { onConflict: 'source_event_id', ignoreDuplicates: false }
        )
        .select('domain_event_id')
        .maybeSingle<{ domain_event_id: string }>();

    if (deErr) throw new Error(`[meli-reconcile] upsert domain event failed: ${deErr.message}`);

    // Defensive fallback: if idempotent conflict returned no row, fetch existing domain_event_id
    let domainEventId = deRow?.domain_event_id ?? null;
    if (!domainEventId) {
        const { data: existingDe, error: existingDeErr } = await supabaseAdmin
            .from('v2_domain_events')
            .select('domain_event_id')
            .eq('source_event_id', webhookEventId)
            .maybeSingle<{ domain_event_id: string }>();
        if (existingDeErr) throw new Error(`[meli-reconcile] lookup existing domain event failed: ${existingDeErr.message}`);
        domainEventId = existingDe?.domain_event_id ?? null;
    }

    // Always invoke typed writer — writeOrderFromDomainEvent upserts v2_orders with ON CONFLICT,
    // so it is fully idempotent regardless of whether domain_event was new or already existed.
    if (domainEventId) {
        await writeOrderFromDomainEvent(
            { log: (msg) => console.log(msg) },
            { ...eventPayload, domain_event_id: domainEventId }
        );
    }

    return Boolean(whRow); // true = new insertion this run; false = already existed (idempotent re-process)
}

// ─── Get store context ───────────────────────────────────────────────
async function getStoreContext(storeId: string): Promise<{ sellerId: string | null; tenantId: string | null }> {
    const { data } = await supabaseAdmin
        .from('v2_stores')
        .select('external_account_id, tenant_id')
        .eq('store_id', storeId)
        .maybeSingle<{ external_account_id: string | null; tenant_id: string | null }>();
    return {
        sellerId: data?.external_account_id ?? null,
        tenantId: data?.tenant_id ?? null
    };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function run(request: NextRequest, limit: number, scope: string): Promise<NextResponse> {
    const workerId = `${process.env.VERCEL_REGION ?? 'local'}:${crypto.randomUUID()}`;
    const bucketMinute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    const t0 = Date.now();

    let scanned = 0;
    let enqueued = 0;
    let claimed = 0;
    let processed = 0;
    let failed = 0;
    let deadLetter = 0;
    const latencies: number[] = [];

    try {
        // ── A) Count active ML stores ───────────────────────────────────────────
        // Two-step: first get store_ids with active tokens, then count ML stores
        const { data: activeTokenStores } = await supabaseAdmin
            .from('v2_oauth_tokens')
            .select('store_id')
            .eq('status', 'active');

        const activeStoreIds = (activeTokenStores ?? []).map((r: { store_id: string }) => r.store_id);

        const { count } = activeStoreIds.length > 0
            ? await supabaseAdmin
                .from('v2_stores')
                .select('*', { count: 'exact', head: true })
                .eq('provider_key', 'mercadolibre')
                .in('store_id', activeStoreIds)
            : { count: 0 };
        scanned = count ?? 0;

        // ── B) Enqueue missing jobs (insert-only, ON CONFLICT DO NOTHING) ────────
        // Raw SQL via RPC for atomic bulk enqueue
        const { error: enqueueErr } = await supabaseAdmin.rpc(
            'v2_enqueue_reconciliation_jobs' as never,
            { p_scope: scope }
        );

        if (enqueueErr) {
            // Fallback: iterate active stores individually
            const { data: activeStores } = await supabaseAdmin
                .from('v2_stores')
                .select('store_id')
                .eq('provider_key', 'mercadolibre');

            for (const { store_id } of (activeStores ?? [])) {
                // Only insert if no token active
                const { data: token } = await supabaseAdmin
                    .from('v2_oauth_tokens')
                    .select('store_id')
                    .eq('store_id', store_id)
                    .eq('status', 'active')
                    .maybeSingle();

                if (!token) continue;

                const { error } = await supabaseAdmin
                    .from('v2_reconciliation_jobs')
                    .insert({
                        store_id,
                        scope,
                        status: 'pending',
                        next_eligible_at: new Date().toISOString(),
                    });
                if (!error) enqueued += 1;
                // ON CONFLICT (store_id, scope) DO NOTHING → conflict = already queued, skip
            }
        } else {
            enqueued = scanned; // approximate
        }

        // ── C) Claim via RPC (SKIP LOCKED) ───────────────────────────────────────
        const { data: jobs, error: claimErr } = await supabaseAdmin
            .rpc('v2_claim_reconciliation_jobs', {
                p_limit: limit,
                p_worker: workerId,
                p_scope: scope,
            });

        if (claimErr) throw new Error(`[meli-reconcile] claim failed: ${claimErr.message}`);
        claimed = (jobs ?? []).length;

        // ── D) Process each job ───────────────────────────────────────────────────
        for (const job of (jobs ?? []) as Array<{
            job_id: string;
            store_id: string;
            scope: string;
            cursor: { offset?: number } | null;
            attempts: number;
        }>) {
            const jobT0 = Date.now();
            const nextAttempts = (job.attempts ?? 0) + 1;
            const nowIso = () => new Date().toISOString();

            try {
                // 1) Get valid ML access token (handles refresh internally)
                const accessToken = await getValidToken(job.store_id);

                // 2) Get store context
                const { sellerId, tenantId } = await getStoreContext(job.store_id);
                if (!sellerId) throw new Error(`[meli-reconcile] No external_account_id for store ${job.store_id}`);
                if (!tenantId) throw new Error(`[meli-reconcile] No tenant_id for store ${job.store_id}`);

                // 3) Determine start offset from cursor
                let offset = job.cursor?.offset ?? 0;
                let hasMore = false;
                let totalProcessed = 0;

                for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
                    const pageData = await fetchOrdersPage(accessToken, sellerId, offset);
                    const results = pageData.results ?? [];

                    for (const order of results) {
                        await upsertDomainEvent(tenantId, job.store_id, order);
                        totalProcessed += 1;
                    }

                    offset += results.length;
                    const total = pageData.paging?.total ?? 0;

                    if (offset >= total || results.length < PAGE_SIZE) {
                        hasMore = false;
                        break;
                    }
                    hasMore = true;
                }

                if (hasMore) {
                    // More pages remain — advance cursor, reschedule
                    await supabaseAdmin
                        .from('v2_reconciliation_jobs')
                        .update({
                            status: 'pending',
                            cursor: { offset },
                            next_eligible_at: new Date(Date.now() + CURSOR_RESUME_MS).toISOString(),
                            locked_at: null,
                            locked_by: null,
                            updated_at: nowIso(),
                        })
                        .eq('job_id', job.job_id);
                } else {
                    // Completed full reconciliation
                    await supabaseAdmin
                        .from('v2_reconciliation_jobs')
                        .update({
                            status: 'done',
                            attempts: 0,
                            cursor: null,
                            last_error: null,
                            locked_at: null,
                            locked_by: null,
                            updated_at: nowIso(),
                        })
                        .eq('job_id', job.job_id);
                }

                processed += totalProcessed;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                const isFatal = err instanceof ReauthorizationRequired
                    || msg.includes('invalid_grant')
                    || msg.includes('ReauthorizationRequired');

                if (isFatal || nextAttempts >= DLQ_THRESHOLD) {
                    await supabaseAdmin
                        .from('v2_reconciliation_jobs')
                        .update({
                            status: 'dead_letter',
                            attempts: nextAttempts,
                            last_error: msg,
                            locked_at: null,
                            locked_by: null,
                            dead_letter_at: nowIso(),
                            updated_at: nowIso(),
                        })
                        .eq('job_id', job.job_id);
                    deadLetter += 1;
                } else {
                    const backoffMs = computeBackoffMs(nextAttempts);
                    await supabaseAdmin
                        .from('v2_reconciliation_jobs')
                        .update({
                            status: 'failed',
                            attempts: nextAttempts,
                            last_error: msg,
                            locked_at: null,
                            locked_by: null,
                            next_eligible_at: new Date(Date.now() + backoffMs).toISOString(),
                            updated_at: nowIso(),
                        })
                        .eq('job_id', job.job_id);
                    failed += 1;
                }
            }

            latencies.push(Date.now() - jobT0);
        }

        const avgLatencyMs = latencies.length
            ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
            : 0;

        // ── E) Heartbeat ──────────────────────────────────────────────────────────
        try {
            await supabaseAdmin
                .from('v2_worker_heartbeats')
                .upsert({
                    worker_name: WORKER_NAME,
                    worker_instance: workerId,
                    last_seen_at: new Date().toISOString(),
                    meta: { scanned, enqueued, claimed, processed, failed, dead_letter: deadLetter, avg_latency_ms: avgLatencyMs },
                }, { onConflict: 'worker_name,worker_instance' });
        } catch { /* best-effort */ }

        // ── F) Runtime metrics ────────────────────────────────────────────────────
        try {
            await supabaseAdmin
                .from('v2_runtime_metrics_minute')
                .upsert({
                    bucket_minute: bucketMinute,
                    worker_name: WORKER_NAME,
                    scanned,
                    enqueued,
                    claimed,
                    processed,
                    failed,
                    dead_letter: deadLetter,
                    avg_latency_ms: avgLatencyMs,
                }, { onConflict: 'bucket_minute,worker_name' });
        } catch { /* best-effort */ }

        return NextResponse.json({
            worker: workerId,
            scope,
            scanned,
            enqueued,
            claimed,
            processed,
            failed,
            dead_letter: deadLetter,
            avg_latency_ms: avgLatencyMs,
            duration_ms: Date.now() - t0,
        }, { status: 200 });

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
    const scope = request.nextUrl.searchParams.get('scope') ?? 'orders';
    return run(request, limit, scope);
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
    const scope = request.nextUrl.searchParams.get('scope') ?? 'orders';
    return run(request, limit, scope);
}
