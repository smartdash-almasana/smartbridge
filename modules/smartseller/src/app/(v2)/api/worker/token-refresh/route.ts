import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@v2/lib/supabase';
import { refreshToken, ReauthorizationRequired } from '@v2/lib/meli-token';

// ─── Auth ─────────────────────────────────────────────────────────────────────
function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function isAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    if (!provided || !expected) return false;
    return provided === expected;
}

function parseLimit(value: string | null): number {
    const n = Number(value ?? '50');
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(Math.floor(n), 200);
}

// ─── Backoff ──────────────────────────────────────────────────────────────────
const BACKOFF_BASE_MS = 60_000;       // 60s
const BACKOFF_CAP_MS = 30 * 60_000;  // 30m
const DLQ_THRESHOLD = 10;
const REFRESH_WINDOW_M = 30;           // enqueue tokens expiring within 30 min

function computeBackoffMs(attempts: number): number {
    const base = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts), BACKOFF_CAP_MS);
    // ±10% jitter
    const jitter = base * 0.1 * (Math.random() * 2 - 1);
    return Math.round(base + jitter);
}

function isFatal(err: unknown): boolean {
    if (err instanceof ReauthorizationRequired) return true;
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('invalid_grant') || msg.includes('ReauthorizationRequired');
}

// ─── Worker core ──────────────────────────────────────────────────────────────
async function run(request: NextRequest, limit: number): Promise<NextResponse> {
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
        // ── A) Count expiring tokens ─────────────────────────────────────────
        const { count } = await supabaseAdmin
            .from('v2_oauth_tokens')
            .select('*', { count: 'exact', head: true })
            .lt('expires_at', new Date(Date.now() + REFRESH_WINDOW_M * 60_000).toISOString())
            .eq('status', 'active');
        scanned = count ?? 0;

        // ── B) Enqueue missing jobs ──────────────────────────────────────────
        const { data: expiring } = await supabaseAdmin
            .from('v2_oauth_tokens')
            .select('store_id')
            .lt('expires_at', new Date(Date.now() + REFRESH_WINDOW_M * 60_000).toISOString())
            .eq('status', 'active');

        for (const { store_id } of (expiring ?? [])) {
            const nowIso = new Date().toISOString();
            const { error } = await supabaseAdmin
                .from('token_refresh_jobs')
                .upsert(
                    {
                        store_id,
                        status: 'pending',
                        next_eligible_at: nowIso,
                        updated_at: nowIso,
                    },
                    {
                        onConflict: 'store_id',
                        ignoreDuplicates: true,
                    }
                )
                .select('store_id, status')
                .maybeSingle()
                .then(async (res) => {
                    // Insert path creates pending job. Existing rows are handled below:
                    // only done/failed are reactivated; running/pending/dead_letter stay unchanged.
                    return res;
                });

            // Reactivate only terminal states. Preserve attempts and locks.
            // LEAST(existing.next_eligible_at, now()):
            // 1) done/failed already eligible (<= now): keep next_eligible_at as-is.
            // 2) done/failed scheduled in future (> now): pull to now.
            if (!error) {
                const { data: reactivatedA } = await supabaseAdmin
                    .from('token_refresh_jobs')
                    .update({ status: 'pending', updated_at: nowIso })
                    .eq('store_id', store_id)
                    .in('status', ['done', 'failed'])
                    .lte('next_eligible_at', nowIso)
                    .select('store_id');

                const { data: reactivatedB } = await supabaseAdmin
                    .from('token_refresh_jobs')
                    .update({ status: 'pending', next_eligible_at: nowIso, updated_at: nowIso })
                    .eq('store_id', store_id)
                    .in('status', ['done', 'failed'])
                    .gt('next_eligible_at', nowIso)
                    .select('store_id'); // only re-enqueue terminal states

                if ((reactivatedA?.length ?? 0) + (reactivatedB?.length ?? 0) > 0) {
                    enqueued += 1;
                }
            }
        }

        // ── C) Claim jobs via RPC (SKIP LOCKED = singleflight) ──────────────
        const { data: jobs, error: claimErr } = await supabaseAdmin
            .rpc('v2_claim_token_refresh_jobs', { p_limit: limit, p_worker: workerId });

        if (claimErr) throw new Error(`[token-refresh] claim failed: ${claimErr.message}`);
        claimed = (jobs ?? []).length;

        // ── D) Process each claimed job ──────────────────────────────────────
        for (const job of (jobs ?? []) as Array<{ store_id: string; attempts: number }>) {
            const jobT0 = Date.now();
            const nextAttempts = (job.attempts ?? 0) + 1;

            try {
                // Execute real refresh — persists to v2_oauth_tokens internally
                await refreshToken(job.store_id);

                // Success
                await supabaseAdmin
                    .from('token_refresh_jobs')
                    .update({
                        status: 'done',
                        attempts: 0,
                        last_error: null,
                        locked_at: null,
                        locked_by: null,
                        next_eligible_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('store_id', job.store_id);

                processed += 1;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);

                if (isFatal(err) || nextAttempts >= DLQ_THRESHOLD) {
                    // Dead letter
                    await supabaseAdmin
                        .from('token_refresh_jobs')
                        .update({
                            status: 'dead_letter',
                            attempts: nextAttempts,
                            last_error: msg,
                            locked_at: null,
                            locked_by: null,
                            dead_letter_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                        })
                        .eq('store_id', job.store_id);
                    deadLetter += 1;
                } else {
                    // Transient failure with exponential backoff
                    const backoffMs = computeBackoffMs(nextAttempts);
                    await supabaseAdmin
                        .from('token_refresh_jobs')
                        .update({
                            status: 'failed',
                            attempts: nextAttempts,
                            last_error: msg,
                            locked_at: null,
                            locked_by: null,
                            next_eligible_at: new Date(Date.now() + backoffMs).toISOString(),
                            updated_at: new Date().toISOString(),
                        })
                        .eq('store_id', job.store_id);
                    failed += 1;
                }
            }

            latencies.push(Date.now() - jobT0);
        }

        // ── E) Heartbeat ─────────────────────────────────────────────────────
        const avgLatencyMs = latencies.length
            ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
            : 0;

        await supabaseAdmin
            .from('v2_worker_heartbeats')
            .upsert({
                worker_name: 'token-refresh',
                worker_instance: workerId,
                last_seen_at: new Date().toISOString(),
                meta: { scanned, enqueued, claimed, processed, failed, dead_letter: deadLetter, avg_latency_ms: avgLatencyMs },
            }, { onConflict: 'worker_name,worker_instance' });

        // ── F) Runtime metrics ───────────────────────────────────────────────
        await supabaseAdmin
            .from('v2_runtime_metrics_minute')
            .upsert({
                bucket_minute: bucketMinute,
                worker_name: 'token-refresh',
                scanned,
                claimed,
                processed,
                failed,
                dead_letter: deadLetter,
                avg_latency_ms: avgLatencyMs,
            }, { onConflict: 'bucket_minute,worker_name' });

        return NextResponse.json({
            worker: workerId,
            scanned,
            enqueued,
            claimed,
            processed,
            failed,
            dead_letter: deadLetter,
            avg_latency_ms: latencies.length
                ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
                : 0,
            duration_ms: Date.now() - t0,
        }, { status: 200 });

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
    return run(request, limit);
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
    return run(request, limit);
}
