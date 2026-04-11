// ============================================================================
// SmartSeller V2 — Refund Metrics Worker (Phase 3.A1)
// Responsibility: compute refunds_count_1d → upsert v2_metrics_daily,
//                derive refund_spike_24h → insert v2_clinical_signals,
//                update v2_health_scores via run_id.
// Scope: 1 metric + 1 signal + 1 score. No writes to other tables.
// No app code, no UI, no external APIs.
// ============================================================================

import { supabaseAdmin } from '../lib/supabase';
import { readSnapshotClinicalInputs } from './snapshot-clinical-inputs';
import { upsertMergedMetricsDaily } from './metrics-daily-writer';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RefundMetricsInput {
    tenant_id: string;
    store_id: string;
    metric_date: string; // 'YYYY-MM-DD' UTC
    run_id: string;
}

export interface RefundMetricsResult {
    metric_date: string;
    refunds_count_1d: number;
    baseline_avg_7d: number;
    severity: 'none' | 'info' | 'warning' | 'critical';
    signal_inserted: boolean;
    score_inserted: boolean;
    skipped: boolean;
    skip_reason?: string;
}

// ── Severity derivation (DB enum: info | warning | critical) ───────────────

function deriveSeverity(n: number, baseline: number): 'none' | 'info' | 'warning' | 'critical' {
    if (n >= 5 && n > baseline * 4) return 'critical';
    if (n >= 3 && n > baseline * 3) return 'warning';
    if (n >= 1 && n > baseline * 2) return 'info';
    return 'none';
}

function severityWeight(s: 'none' | 'info' | 'warning' | 'critical'): number {
    switch (s) {
        case 'critical': return 25;
        case 'warning': return 15;
        case 'info': return 5;
        default: return 0;
    }
}

// ── Main worker ────────────────────────────────────────────────────────────

export async function runRefundMetricsWorker(
    input: RefundMetricsInput
): Promise<RefundMetricsResult> {
    const { tenant_id, store_id, metric_date, run_id } = input;
    const log = (msg: string) => console.log(`[refund-metrics-worker] ${msg}`);

    // ── Step 1: Read metric input from canonical snapshot payload ──────────────
    const snapshotInputs = await readSnapshotClinicalInputs({ tenant_id, store_id, run_id });
    const refunds_count_1d = snapshotInputs.refunds_count_1d;
    const sampleIds = snapshotInputs.refunds_sample_ids.slice(0, 20);

    log(`refunds_count_1d=${refunds_count_1d} for store=${store_id} date=${metric_date}`);

    // ── Step 2: Upsert v2_metrics_daily ────────────────────────────────────
    // Merge refunds_count_1d into existing JSONB without overwriting other keys.
    await upsertMergedMetricsDaily({
        tenant_id,
        store_id,
        metric_date,
        metrics_patch: { refunds_count_1d },
    });

    log(`v2_metrics_daily upserted`);

    // ── Step 3: Compute baseline from last 7 days (excluding today) ─────────
    const sevenDaysAgo = new Date(metric_date);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    const { data: histRows, error: histErr } = await supabaseAdmin
        .from('v2_metrics_daily')
        .select('metrics')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .gte('metric_date', sevenDaysAgoStr)
        .lt('metric_date', metric_date);

    if (histErr) {
        throw new Error(`[step3] Cannot fetch baseline: ${histErr.message}`);
    }

    const historicalValues = (histRows ?? [])
        .map((r: { metrics: Record<string, unknown> }) => Number((r.metrics as Record<string, unknown>)?.refunds_count_1d ?? 0));
    const baseline_avg_7d = historicalValues.length > 0
        ? historicalValues.reduce((a: number, b: number) => a + b, 0) / historicalValues.length
        : 0;

    // ── Step 4: Derive severity ─────────────────────────────────────────────
    const severity = deriveSeverity(refunds_count_1d, baseline_avg_7d);
    log(`baseline_avg_7d=${baseline_avg_7d.toFixed(2)} severity=${severity}`);

    if (severity === 'none') {
        log(`No signal threshold met — skipping signal and score.`);
        return {
            metric_date,
            refunds_count_1d,
            baseline_avg_7d,
            severity,
            signal_inserted: false,
            score_inserted: false,
            skipped: true,
            skip_reason: `severity=none (N=${refunds_count_1d}, baseline=${baseline_avg_7d.toFixed(2)})`,
        };
    }

    // ── Pre-Step 6: Idempotency Check ───────────────────────────────────────
    const { data: existSignal } = await supabaseAdmin
        .from('v2_clinical_signals')
        .select('signal_id')
        .eq('run_id', run_id)
        .eq('signal_key', 'refund_spike_24h')
        .limit(1)
        .maybeSingle();

    if (existSignal) {
        log(`Idempotency: signal refund_spike_24h already exists for run_id=${run_id}. Skipping.`);
        return {
            metric_date,
            refunds_count_1d,
            baseline_avg_7d,
            severity,
            signal_inserted: false,
            score_inserted: false,
            skipped: true,
            skip_reason: `idempotency: signal exists`,
        };
    }

    // ── Step 6: Insert v2_clinical_signals ─────────────────────────────────
    // Signal key: refund_spike_24h. No UNIQUE on table → plain INSERT per run.
    const evidence = {
        refunds_count_1d,
        baseline_avg_7d: parseFloat(baseline_avg_7d.toFixed(4)),
        window_days: 7,
        metric_date,
        sample_refund_ids: sampleIds,
    };

    const { error: signalErr } = await supabaseAdmin
        .from('v2_clinical_signals')
        .insert({
            tenant_id,
            store_id,
            run_id,
            signal_key: 'refund_spike_24h',
            severity,
            evidence,
            created_at: new Date().toISOString(),
        });

    if (signalErr) {
        throw new Error(`[step6] Cannot insert clinical_signal: ${signalErr.message}`);
    }

    log(`v2_clinical_signals inserted (run_id=${run_id})`);

    // ── Step 7: Insert / Upsert v2_health_scores ─────────────────────────
    const { data: existScore } = await supabaseAdmin
        .from('v2_health_scores')
        .select('score')
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .maybeSingle();

    const currentScore = existScore ? existScore.score : 100;
    const newScore = Math.max(0, Math.min(currentScore, currentScore - severityWeight(severity)));

    const { error: scoreErr } = await supabaseAdmin
        .from('v2_health_scores')
        .upsert({
            tenant_id,
            store_id,
            run_id,
            score: newScore,
            computed_at: new Date().toISOString(),
        }, { onConflict: 'store_id,run_id' });

    if (scoreErr) {
        throw new Error(`[step7] Cannot insert health_score: ${scoreErr.message}`);
    }

    log(`v2_health_scores inserted score=${newScore}`);

    // ── Engine run closing handled by orchestrator ──

    return {
        metric_date,
        refunds_count_1d,
        baseline_avg_7d,
        severity,
        signal_inserted: true,
        score_inserted: true,
        skipped: false,
    };
}
