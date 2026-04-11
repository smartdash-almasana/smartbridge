// ============================================================================
// SmartSeller V2 — Score API  (Score V0 — deterministic, DB-only)
// GET /api/score/[store_id]
//
// Flow:
//   1. Read latest health_score for store_id.
//   2. If computed_at < 1h ago → stale or missing → recalculate.
//   3. Recalculate:
//      a. Aggregate today's metrics from v2_domain_events  → upsert v2_metrics_daily
//      b. Read 7d / 14d aggregates from v2_metrics_daily   → evaluate 5 signals
//      c. Upsert v2_clinical_signals (one row per signal)
//      d. Compute score (0–100) via penalty formula
//      e. Insert v2_snapshots with full audit payload
//      f. Upsert v2_health_scores
//   4. Return ScoreResponse with snapshot_id / run_id / score / computed_at
// ============================================================================

import { supabaseAdmin } from '@v2/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreResponse {
    store_id: string;
    score: number;
    computed_at: string;
    run_id: string;
    snapshot_id: string;
    active_signals: Array<{
        signal_key: string;
        severity: 'info' | 'warning' | 'critical';
        evidence: Record<string, unknown>;
    }>;
}

interface DailyMetrics {
    orders_created_1d: number;
    orders_cancelled_1d: number;
    messages_received_1d: number;
    messages_answered_1d: number;
    claims_opened_1d: number;
}

interface WindowSums {
    orders_created: number;
    orders_cancelled: number;
    messages_received: number;
    messages_answered: number;
    claims_opened: number;
}

interface Signal {
    signal_key: string;
    severity: 'info' | 'warning' | 'critical';
    penalty: number;
    evidence: Record<string, unknown>;
}

interface PersistedSignalRow {
    signal_key: string;
    severity: 'info' | 'warning' | 'critical';
    evidence: Record<string, unknown> | null;
}

interface CachedScoreRow {
    store_id: string;
    score: number;
    computed_at: string;
    run_id: string;
    snapshot_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayUTC(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function isFresh(computedAt: string, maxAgeMs = 60 * 60 * 1000): boolean {
    return Date.now() - new Date(computedAt).getTime() < maxAgeMs;
}

function sortSignalsBySeverity<T extends { severity: 'info' | 'warning' | 'critical' }>(signals: T[]): T[] {
    const weight = { critical: 3, warning: 2, info: 1 };
    return [...signals].sort((a, b) => weight[b.severity] - weight[a.severity]);
}

async function getSignalsForRun(runId: string): Promise<ScoreResponse['active_signals']> {
    const { data, error } = await supabaseAdmin
        .from('v2_clinical_signals')
        .select('signal_key,severity,evidence')
        .eq('run_id', runId);

    if (error) throw new Error(`[score-v0] clinical signals read failed: ${error.message}`);

    const rows = (data ?? []) as PersistedSignalRow[];
    return sortSignalsBySeverity(
        rows.map((row) => ({
            signal_key: row.signal_key,
            severity: row.severity,
            evidence: (row.evidence ?? {}) as Record<string, unknown>,
        })),
    );
}

// ─── Step 1: Resolve tenant_id ────────────────────────────────────────────────

async function getTenantId(storeId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from('v2_stores')
        .select('tenant_id')
        .eq('store_id', storeId)
        .limit(1)
        .maybeSingle<{ tenant_id: string }>();

    if (error) throw new Error(`[score-v0] tenant lookup failed: ${error.message}`);
    if (!data?.tenant_id) throw new Error(`[score-v0] no tenant for store ${storeId}`);
    return data.tenant_id;
}

// ─── Step 2: Aggregate today's metrics from v2_domain_events ─────────────────

async function aggregateTodayMetrics(storeId: string): Promise<DailyMetrics> {
    const todayStart = `${todayUTC()}T00:00:00Z`;
    const todayEnd = `${todayUTC()}T23:59:59Z`;

    const { data, error } = await supabaseAdmin
        .from('v2_domain_events')
        .select('event_type')
        .eq('store_id', storeId)
        .gte('occurred_at', todayStart)
        .lte('occurred_at', todayEnd);

    if (error) throw new Error(`[score-v0] domain_events agg failed: ${error.message}`);

    const rows = data ?? [];
    const count = (et: string) => rows.filter(r => r.event_type === et).length;

    return {
        orders_created_1d: count('order.created'),
        orders_cancelled_1d: count('order.cancelled'),
        messages_received_1d: count('message.received'),
        messages_answered_1d: count('message.answered'),
        claims_opened_1d: count('claim.opened'),
    };
}

// ─── Step 3: Upsert today's metrics into v2_metrics_daily ────────────────────

async function upsertDailyMetrics(
    tenantId: string,
    storeId: string,
    metrics: DailyMetrics,
): Promise<void> {
    const { error } = await supabaseAdmin
        .from('v2_metrics_daily')
        .upsert(
            {
                tenant_id: tenantId,
                store_id: storeId,
                metric_date: todayUTC(),
                metrics: metrics,
            },
            { onConflict: 'tenant_id,store_id,metric_date' },
        );

    if (error) throw new Error(`[score-v0] metrics_daily upsert failed: ${error.message}`);
}

// ─── Step 4: Read window aggregates (7d / 14d) from v2_metrics_daily ─────────

async function getWindowSums(
    tenantId: string,
    storeId: string,
    days: number,
): Promise<WindowSums> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    const sinceDate = since.toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
        .from('v2_metrics_daily')
        .select('metrics')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .gte('metric_date', sinceDate);

    if (error) throw new Error(`[score-v0] window sums failed (${days}d): ${error.message}`);

    const sums: WindowSums = {
        orders_created: 0,
        orders_cancelled: 0,
        messages_received: 0,
        messages_answered: 0,
        claims_opened: 0,
    };

    for (const row of (data ?? [])) {
        const m = (row.metrics ?? {}) as Record<string, number>;
        sums.orders_created += m['orders_created_1d'] ?? 0;
        sums.orders_cancelled += m['orders_cancelled_1d'] ?? 0;
        sums.messages_received += m['messages_received_1d'] ?? 0;
        sums.messages_answered += m['messages_answered_1d'] ?? 0;
        sums.claims_opened += m['claims_opened_1d'] ?? 0;
    }

    return sums;
}

// ─── Step 5: Evaluate 5 signals ───────────────────────────────────────────────

function evaluateSignals(
    today: DailyMetrics,
    sums7d: WindowSums,
    sums14d: WindowSums,
): Signal[] {
    const signals: Signal[] = [];

    // S1: no_orders_7d (critical, -40)
    if (sums7d.orders_created === 0) {
        signals.push({
            signal_key: 'no_orders_7d',
            severity: 'critical',
            penalty: 40,
            evidence: { orders_created_7d: 0 },
        });
    }

    // S2: cancellation_spike (critical, -25)  today: cancelled / max(created,1) > 0.3
    const cancelRatio = today.orders_cancelled_1d / Math.max(today.orders_created_1d, 1);
    if (cancelRatio > 0.3) {
        signals.push({
            signal_key: 'cancellation_spike',
            severity: 'critical',
            penalty: 25,
            evidence: {
                orders_cancelled_1d: today.orders_cancelled_1d,
                orders_created_1d: today.orders_created_1d,
                ratio: Math.round(cancelRatio * 100) / 100,
            },
        });
    }

    // S3: unanswered_messages_spike (critical, -20)  today: received > 5 AND answered == 0
    if (today.messages_received_1d > 5 && today.messages_answered_1d === 0) {
        signals.push({
            signal_key: 'unanswered_messages_spike',
            severity: 'critical',
            penalty: 20,
            evidence: {
                messages_received_1d: today.messages_received_1d,
                messages_answered_1d: 0,
            },
        });
    }

    // S4: claims_opened (warning, -10)  14d: at least 1 claim
    if (sums14d.claims_opened > 0) {
        signals.push({
            signal_key: 'claims_opened',
            severity: 'warning',
            penalty: 10,
            evidence: { claims_opened_14d: sums14d.claims_opened },
        });
    }

    // S5: low_activity_14d (info, -5)  14d: orders + messages < 3
    const activity14d = sums14d.orders_created + sums14d.messages_received;
    if (activity14d < 3) {
        signals.push({
            signal_key: 'low_activity_14d',
            severity: 'info',
            penalty: 5,
            evidence: {
                orders_created_14d: sums14d.orders_created,
                messages_received_14d: sums14d.messages_received,
                total_activity: activity14d,
            },
        });
    }

    return signals;
}

// ─── Step 6: Upsert clinical signals ─────────────────────────────────────────

async function persistSignals(
    tenantId: string,
    storeId: string,
    runId: string,
    snapshotId: string,
    signals: Signal[],
): Promise<void> {
    if (signals.length === 0) return;

    const rows = signals.map(s => ({
        store_id: storeId,
        tenant_id: tenantId,
        run_id: runId,
        snapshot_id: snapshotId,
        signal_key: s.signal_key,
        severity: s.severity,
        evidence: s.evidence,
    }));

    const { error } = await supabaseAdmin
        .from('v2_clinical_signals')
        .insert(rows);

    if (error) throw new Error(`[score-v0] signals insert failed: ${error.message}`);
}

// ─── Step 7: Create snapshot ──────────────────────────────────────────────────

async function createSnapshot(
    tenantId: string,
    storeId: string,
    runId: string,
    payload: Record<string, unknown>,
): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from('v2_snapshots')
        .insert({
            tenant_id: tenantId,
            store_id: storeId,
            snapshot_at: new Date().toISOString(),
            run_id: runId,
            payload,
        })
        .select('snapshot_id')
        .single<{ snapshot_id: string }>();

    if (error) throw new Error(`[score-v0] snapshot insert failed: ${error.message}`);
    return data.snapshot_id;
}

// ─── Step 8: Upsert health score ──────────────────────────────────────────────

async function persistScore(
    tenantId: string,
    storeId: string,
    runId: string,
    snapshotId: string,
    score: number,
    computedAt: string,
): Promise<void> {
    const { error } = await supabaseAdmin
        .from('v2_health_scores')
        .upsert(
            {
                tenant_id: tenantId,
                store_id: storeId,
                run_id: runId,
                snapshot_id: snapshotId,
                score,
                computed_at: computedAt,
            },
            { onConflict: 'store_id,run_id' },
        );

    if (error) throw new Error(`[score-v0] health_scores upsert failed: ${error.message}`);
}

// ─── Step 0: Engine Run lifecycle ────────────────────────────────────────────

async function createEngineRun(tenantId: string, storeId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from('v2_engine_runs')
        .insert({ tenant_id: tenantId, store_id: storeId, status: 'running' })
        .select('run_id')
        .single<{ run_id: string }>();

    if (error) throw new Error(`[score-v0] engine_run create failed: ${error.message}`);
    return data.run_id;
}

async function finalizeEngineRun(runId: string, status: 'done' | 'failed'): Promise<void> {
    const { error } = await supabaseAdmin
        .from('v2_engine_runs')
        .update({ status, finished_at: new Date().toISOString() })
        .eq('run_id', runId);
    if (error) throw new Error(`[score-v0] engine_run finalize failed: ${error.message}`);
}

// ─── Main: getLatestScore ─────────────────────────────────────────────────────

export async function getLatestScore(storeId: string): Promise<ScoreResponse | null> {
    // 1. Check for a fresh cached score (< 1h)
    const { data: existing, error: readErr } = await supabaseAdmin
        .from('v2_health_scores')
        .select('store_id, score, computed_at, run_id, snapshot_id')
        .eq('store_id', storeId)
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle<CachedScoreRow>();

    if (readErr) throw new Error(`[score-v0] read health_scores failed: ${readErr.message}`);

    if (existing && isFresh(existing.computed_at)) {
        const activeSignals = await getSignalsForRun(existing.run_id);
        return { ...existing, active_signals: activeSignals };
    }

    // 2. Resolve tenant
    const tenantId = await getTenantId(storeId);

    // 3. Aggregate today
    const today = await aggregateTodayMetrics(storeId);
    await upsertDailyMetrics(tenantId, storeId, today);

    // 4. Window sums
    const sums7d = await getWindowSums(tenantId, storeId, 7);
    const sums14d = await getWindowSums(tenantId, storeId, 14);

    // 5. Evaluate signals
    const signals = evaluateSignals(today, sums7d, sums14d);

    // 6. Create engine run (satisfies FK on clinical_signals and health_scores)
    const runId = await createEngineRun(tenantId, storeId);
    const computedAt = new Date().toISOString();

    try {
        // 7. Calculate score
        const penalty = signals.reduce((acc, s) => acc + s.penalty, 0);
        const score = Math.max(0, 100 - penalty);

        // 8. Create snapshot (audit payload)
        const snapshotPayload = {
            source: 'score-v0',
            computed_at: computedAt,
            metrics_today: today,
            sums_7d: sums7d,
            sums_14d: sums14d,
            triggered_signals: signals.map(s => ({ key: s.signal_key, penalty: s.penalty })),
            score_v0: score,
        };
        const snapshotId = await createSnapshot(tenantId, storeId, runId, snapshotPayload);

        // 9. Persist signals (with snapshot linkage)
        await persistSignals(tenantId, storeId, runId, snapshotId, signals);

        // 10. Persist score
        await persistScore(tenantId, storeId, runId, snapshotId, score, computedAt);

        await finalizeEngineRun(runId, 'done');
        return {
            store_id: storeId,
            score,
            computed_at: computedAt,
            run_id: runId,
            snapshot_id: snapshotId,
            active_signals: sortSignalsBySeverity(
                signals.map((signal) => ({
                    signal_key: signal.signal_key,
                    severity: signal.severity,
                    evidence: signal.evidence,
                })),
            ),
        };
    } catch (err) {
        await finalizeEngineRun(runId, 'failed').catch((finalizeErr) => {
            const message = finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr);
            console.error('[score-v0] finalize failed run update', message);
        });
        throw err;
    }
}
