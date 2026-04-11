import { supabaseAdmin } from '../lib/supabase';
import { logIngestAttempt } from './ingest-attempts';

type JsonMap = Record<string, unknown>;

export interface WebhookEventInput {
    event_id: string;
    store_id: string;
    tenant_id?: string | null;
    topic: string;
    resource?: string | null;
    received_at: string;
    raw_payload?: JsonMap | null;
}

export interface WorkerRunResult {
    scanned: number;
    inserted: number;
    deduped: number;
    // DLQ-mode counters (always 0 in normal mode)
    retried: number;
    skipped: number;
    errors: number;
}

interface DomainEventInsert {
    source_event_id: string;
    store_id: string;
    tenant_id?: string | null;
    event_type: string;
    entity_type: string;
    entity_id: string;
    occurred_at: string;
    payload: JsonMap | null;
}

export interface WorkerDeps {
    loadWebhookEvents: (limit: number) => Promise<WebhookEventInput[]>;
    loadDlqEvents: (limit: number) => Promise<WebhookEventInput[]>;
    insertDomainEvent: (event: DomainEventInsert) => Promise<boolean>;
}

function mapTopic(topic: string): { event_type: string; entity_type: string } {
    switch (topic) {
        case 'orders_v2':
            return { event_type: 'order.updated', entity_type: 'order' };
        case 'payments':
            return { event_type: 'payment.updated', entity_type: 'payment' };
        case 'questions':
            return { event_type: 'question.received', entity_type: 'question' };
        case 'messages':
            return { event_type: 'message.received', entity_type: 'message' };
        default:
            return { event_type: topic, entity_type: 'unknown' };
    }
}

function extractEntityId(resource: string | null | undefined): string {
    if (!resource) return 'unknown';
    const trimmed = resource.replace(/\/$/, '');
    const last = trimmed.split('/').pop();
    return last && last.trim() !== '' ? last.trim() : resource;
}

const DLQ_THRESHOLD = 10;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;

function computeBackoffMs(attempts: number): number {
    const base = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts), BACKOFF_CAP_MS);
    const jitter = base * 0.1 * (Math.random() * 2 - 1);
    return Math.round(base + jitter);
}

const dbDeps: WorkerDeps = {
    async loadWebhookEvents(limit: number): Promise<WebhookEventInput[]> {
        const candidateLimit = Math.min(Math.max(limit * 4, limit), 2000);

        const { data, error } = await supabaseAdmin
            .from('v2_webhook_events')
            .select('event_id, store_id, tenant_id, topic, resource, received_at, raw_payload')
            .order('received_at', { ascending: true })
            .limit(candidateLimit);

        if (error) {
            throw new Error(`[v2-worker] load webhook events failed: ${error.message}`);
        }

        const rows = (data ?? []) as WebhookEventInput[];
        if (rows.length === 0) return rows;

        const eventIds = rows.map((r) => r.event_id);
        const { data: existing, error: existingError } = await supabaseAdmin
            .from('v2_domain_events')
            .select('source_event_id')
            .in('source_event_id', eventIds);

        if (existingError) {
            throw new Error(`[v2-worker] load existing domain events failed: ${existingError.message}`);
        }

        const processed = new Set(
            ((existing ?? []) as Array<{ source_event_id: string | null }>)
                .map((r) => r.source_event_id)
                .filter((v): v is string => Boolean(v))
        );

        return rows.filter((r) => !processed.has(r.event_id)).slice(0, limit);
    },

    async insertDomainEvent(event: DomainEventInsert): Promise<boolean> {
        const { data, error } = await supabaseAdmin
            .from('v2_domain_events')
            .upsert(event, { onConflict: 'source_event_id', ignoreDuplicates: true })
            .select('domain_event_id')
            .maybeSingle<{ domain_event_id: string }>();

        if (error) {
            throw new Error(`[v2-worker] insert domain event failed: ${error.message}`);
        }

        return Boolean(data);
    },

    async loadDlqEvents(limit: number): Promise<WebhookEventInput[]> {
        // DLQ candidates: webhook_events that:
        //   - had at least one error attempt
        //   - have no corresponding domain_event
        //   - have fewer than 10 total attempts
        //   - last attempt was > 10 minutes ago (backoff)
        const safeLimit = Math.min(Math.max(limit, 1), 200);

        const { data, error } = await supabaseAdmin.rpc('v2_dlq_candidates', {
            p_limit: safeLimit,
            p_backoff_minutes: 10,
            p_max_attempts: 10,
        });

        if (error) {
            // Fallback: if the RPC doesn't exist yet, use inline SQL via raw JS query
            // This path exists only during migration before the view/function is created.
            throw new Error(`[v2-worker] load DLQ events failed: ${error.message}`);
        }

        // RPC returns rows matching WebhookEventInput shape (event_id, store_id, tenant_id, topic, resource, received_at, raw_payload)
        return (data ?? []) as WebhookEventInput[];
    },
};

// ── Low-level DLQ loader (direct SQL, no RPC dependency) ─────────────────────
// Used as the primary DLQ loader; avoids a DB function dependency.
async function loadDlqEventsDirect(limit: number): Promise<WebhookEventInput[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    // Step 1: aggregate attempt stats per event
    const { data: stats, error: statsError } = await supabaseAdmin
        .from('v2_ingest_attempts')
        .select('event_id, status, created_at')
        .not('event_id', 'is', null);

    if (statsError) throw new Error(`[v2-worker/dlq] load attempt stats failed: ${statsError.message}`);

    // Build per-event aggregates in JS (avoids needing a DB view/function)
    const statsMap = new Map<string, { total: number; hasError: boolean; lastAt: Date }>();
    for (const row of (stats ?? []) as Array<{ event_id: string; status: string; created_at: string }>) {
        const existing = statsMap.get(row.event_id);
        const ts = new Date(row.created_at);
        if (!existing) {
            statsMap.set(row.event_id, { total: 1, hasError: row.status === 'error', lastAt: ts });
        } else {
            existing.total += 1;
            if (row.status === 'error') existing.hasError = true;
            if (ts > existing.lastAt) existing.lastAt = ts;
        }
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // Filter to DLQ-eligible event_ids
    const eligible = [...statsMap.entries()]
        .filter(([, s]) =>
            s.hasError &&
            s.total < 10 &&
            s.lastAt < tenMinutesAgo
        )
        .map(([id]) => id)
        .slice(0, safeLimit);

    if (eligible.length === 0) return [];

    // Step 2: load the webhook_events for eligible ids
    const { data: events, error: eventsError } = await supabaseAdmin
        .from('v2_webhook_events')
        .select('event_id, store_id, tenant_id, topic, resource, received_at, raw_payload')
        .in('event_id', eligible);

    if (eventsError) throw new Error(`[v2-worker/dlq] load webhook events failed: ${eventsError.message}`);

    // Step 3: exclude any that already have a domain_event (defensive dedup)
    const candidateIds = (events ?? []).map((e: any) => e.event_id as string);
    if (candidateIds.length === 0) return [];

    const { data: existing, error: existingError } = await supabaseAdmin
        .from('v2_domain_events')
        .select('source_event_id')
        .in('source_event_id', candidateIds);

    if (existingError) throw new Error(`[v2-worker/dlq] check domain events failed: ${existingError.message}`);

    const done = new Set(
        ((existing ?? []) as Array<{ source_event_id: string | null }>)
            .map((r) => r.source_event_id)
            .filter((v): v is string => Boolean(v))
    );

    return ((events ?? []) as WebhookEventInput[]).filter((e) => !done.has(e.event_id));
}

export async function runV2WebhookToDomainWorkerWithDeps(
    deps: WorkerDeps,
    limit = 50
): Promise<WorkerRunResult> {
    const rows = await deps.loadWebhookEvents(limit);
    const nowIso = new Date().toISOString();
    const { count: claimableCount } = await supabaseAdmin
        .from('v2_webhook_ingest_jobs')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'failed'])
        .or(`next_eligible_at.is.null,next_eligible_at.lte.${nowIso}`);
    let inserted = 0;
    let deduped = 0;

    for (const row of rows) {
        const mapped = mapTopic(row.topic);
        try {
            const created = await deps.insertDomainEvent({
                source_event_id: row.event_id,
                store_id: row.store_id,
                tenant_id: row.tenant_id ?? null,
                event_type: mapped.event_type,
                entity_type: mapped.entity_type,
                entity_id: extractEntityId(row.resource ?? null),
                occurred_at: row.received_at,
                payload: (row.raw_payload as JsonMap | null) ?? null,
            });

            if (created) inserted += 1;
            else deduped += 1;

            await logIngestAttempt({
                event_id: row.event_id,
                store_id: row.store_id,
                worker: 'v2-webhook-to-domain',
                status: created ? 'ok' : 'skipped',
            });
        } catch (error: any) {
            await logIngestAttempt({
                event_id: row.event_id,
                store_id: row.store_id,
                worker: 'v2-webhook-to-domain',
                status: 'error',
                error_message: error.message,
                error_detail: { stack: error.stack },
            });
            throw error;
        }
    }

    return {
        scanned: Math.max(rows.length, claimableCount ?? 0),
        inserted,
        deduped,
        retried: 0,
        skipped: 0,
        errors: 0,
    };
}

export async function runV2WebhookToDomainWorker(limit = 50): Promise<WorkerRunResult> {
    const workerId = `${process.env.VERCEL_REGION ?? 'local'}:${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();

    const { count: claimableCount } = await supabaseAdmin
        .from('v2_webhook_ingest_jobs')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'failed'])
        .or(`next_eligible_at.is.null,next_eligible_at.lte.${nowIso}`);

    let inserted = 0;
    let deduped = 0;
    let failed = 0;
    let deadLetter = 0;
    let claimed = 0;
    let enqueued = 0;

    const { error: enqueueErr } = await supabaseAdmin.rpc('v2_enqueue_webhook_ingest_jobs' as never);
    if (!enqueueErr) enqueued = claimableCount ?? 0;

    const { data: jobs, error: claimErr } = await supabaseAdmin
        .rpc('v2_claim_webhook_ingest_jobs', { p_limit: limit, p_worker: workerId });
    if (claimErr) throw new Error(`[v2-worker] claim failed: ${claimErr.message}`);

    const claimedJobs = (jobs ?? []) as Array<{ event_id: string; attempts: number }>;
    claimed = claimedJobs.length;

    const claimedIds = claimedJobs.map((j) => j.event_id);
    const attemptsByEventId = new Map(claimedJobs.map((j) => [j.event_id, j.attempts ?? 0]));

    const { data: eventRows } = claimedIds.length > 0
        ? await supabaseAdmin
            .from('v2_webhook_events')
            .select('event_id, store_id, tenant_id, topic, resource, received_at, raw_payload')
            .in('event_id', claimedIds)
        : { data: [] };

    const eventMap = new Map(((eventRows ?? []) as WebhookEventInput[]).map((e) => [e.event_id, e]));

    for (const eventId of claimedIds) {
        const row = eventMap.get(eventId);
        const attempts = attemptsByEventId.get(eventId) ?? 0;
        const nextAttempts = attempts + 1;

        if (!row) {
            await supabaseAdmin
                .from('v2_webhook_ingest_jobs')
                .update({ status: 'done', locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
                .eq('event_id', eventId);
            continue;
        }

        const mapped = mapTopic(row.topic);

        try {
            const created = await dbDeps.insertDomainEvent({
                source_event_id: row.event_id,
                store_id: row.store_id,
                tenant_id: row.tenant_id ?? null,
                event_type: mapped.event_type,
                entity_type: mapped.entity_type,
                entity_id: extractEntityId(row.resource ?? null),
                occurred_at: row.received_at,
                payload: (row.raw_payload as JsonMap | null) ?? null,
            });

            if (created) inserted += 1;
            else deduped += 1;

            await supabaseAdmin
                .from('v2_webhook_ingest_jobs')
                .update({
                    status: 'done',
                    attempts: 0,
                    last_error: null,
                    locked_at: null,
                    locked_by: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('event_id', eventId);

            await logIngestAttempt({
                event_id: row.event_id,
                store_id: row.store_id,
                worker: 'v2-webhook-to-domain',
                status: created ? 'ok' : 'skipped',
            });
        } catch (error: any) {
            const msg = error?.message ?? String(error);

            if (nextAttempts >= DLQ_THRESHOLD) {
                await supabaseAdmin
                    .from('v2_webhook_ingest_jobs')
                    .update({
                        status: 'dead_letter',
                        attempts: nextAttempts,
                        last_error: msg,
                        locked_at: null,
                        locked_by: null,
                        dead_letter_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('event_id', eventId);
                deadLetter += 1;
            } else {
                await supabaseAdmin
                    .from('v2_webhook_ingest_jobs')
                    .update({
                        status: 'failed',
                        attempts: nextAttempts,
                        last_error: msg,
                        locked_at: null,
                        locked_by: null,
                        next_eligible_at: new Date(Date.now() + computeBackoffMs(nextAttempts)).toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('event_id', eventId);
                failed += 1;
            }

            await logIngestAttempt({
                event_id: row.event_id,
                store_id: row.store_id,
                worker: 'v2-webhook-to-domain',
                status: 'error',
                error_message: msg,
                error_detail: { stack: error?.stack },
            });
        }
    }

    try {
        await supabaseAdmin
            .from('v2_worker_heartbeats')
            .upsert({
                worker_name: 'v2-webhook-to-domain',
                worker_instance: workerId,
                last_seen_at: new Date().toISOString(),
                meta: {
                    scanned: claimableCount ?? 0,
                    enqueued,
                    claimed,
                    inserted,
                    deduped,
                    failed,
                    dead_letter: deadLetter,
                },
            }, { onConflict: 'worker_name,worker_instance' });
    } catch {
        // best effort
    }

    return {
        scanned: claimableCount ?? 0,
        inserted,
        deduped,
        retried: 0,
        skipped: 0,
        errors: failed + deadLetter,
    };
}

// ── DLQ mode ──────────────────────────────────────────────────────────────────

export async function runV2WebhookToDomainWorkerDlq(limit = 50): Promise<WorkerRunResult> {
    const rows = await loadDlqEventsDirect(limit);
    let inserted = 0;
    let deduped = 0;
    let retried = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
        const mapped = mapTopic(row.topic);
        retried += 1;
        try {
            const created = await dbDeps.insertDomainEvent({
                source_event_id: row.event_id,
                store_id: row.store_id,
                tenant_id: row.tenant_id ?? null,
                event_type: mapped.event_type,
                entity_type: mapped.entity_type,
                entity_id: extractEntityId(row.resource ?? null),
                occurred_at: row.received_at,
                payload: (row.raw_payload as JsonMap | null) ?? null,
            });

            if (created) inserted += 1;
            else {
                deduped += 1;
                skipped += 1; // already existed — not really an error
            }

            await logIngestAttempt({
                event_id: row.event_id,
                store_id: row.store_id,
                worker: 'v2-webhook-to-domain-dlq',
                status: created ? 'ok' : 'skipped',
            });
        } catch (error: any) {
            errors += 1;
            await logIngestAttempt({
                event_id: row.event_id,
                store_id: row.store_id,
                worker: 'v2-webhook-to-domain-dlq',
                status: 'error',
                error_message: error.message,
                error_detail: { stack: error.stack },
            });
            // continue — DLQ must never abort the whole batch on one failure
        }
    }

    return {
        scanned: rows.length,
        inserted,
        deduped,
        retried,
        skipped,
        errors,
    };
}
