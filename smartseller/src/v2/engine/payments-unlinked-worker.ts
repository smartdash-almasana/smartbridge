// ============================================================================
// SmartSeller V2 — Unlinked Payments Metrics Worker (Phase 3.A2)
// Responsibility: compute payments_unlinked_1d → upsert v2_metrics_daily,
//                derive payments_without_orders_24h → insert v2_clinical_signals,
//                update v2_health_scores via run_id.
// Scope: 1 metric + 1 signal + 1 score. No writes to other tables.
// No app code, no UI, no external APIs.
// ============================================================================

import { supabaseAdmin } from '../lib/supabase';
import { readSnapshotClinicalInputs } from './snapshot-clinical-inputs';
import { upsertMergedMetricsDaily } from './metrics-daily-writer';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaymentsUnlinkedInput {
    tenant_id: string;
    store_id: string;
    metric_date: string; // 'YYYY-MM-DD' UTC
    run_id: string;
}

export interface PaymentsUnlinkedResult {
    metric_date: string;
    payments_unlinked_1d: number;
    severity: 'none' | 'info' | 'warning' | 'critical';
    signal_inserted: boolean;
    score_inserted: boolean;
    skipped: boolean;
    skip_reason?: string;
}

// ── Severity derivation (DB enum: info | warning | critical) ───────────────

function deriveSeverity(n: number): 'none' | 'info' | 'warning' | 'critical' {
    if (n >= 5) return 'critical';
    if (n >= 3) return 'warning';
    if (n >= 1) return 'info';
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

export async function runPaymentsUnlinkedWorker(
    input: PaymentsUnlinkedInput
): Promise<PaymentsUnlinkedResult> {
    const { tenant_id, store_id, metric_date, run_id } = input;
    const log = (msg: string) => console.log(`[payments-unlinked-worker] ${msg}`);

    // ── Step 1: Read metric input from canonical snapshot payload ──────────────
    const snapshotInputs = await readSnapshotClinicalInputs({ tenant_id, store_id, run_id });
    const payments_unlinked_1d = snapshotInputs.payments_unlinked_1d;
    const sampleIds = snapshotInputs.payments_sample_ids.slice(0, 20);

    log(`payments_unlinked_1d=${payments_unlinked_1d} for store=${store_id} date=${metric_date}`);

    // ── Step 2: Upsert v2_metrics_daily ────────────────────────────────────
    await upsertMergedMetricsDaily({
        tenant_id,
        store_id,
        metric_date,
        metrics_patch: { payments_unlinked_1d },
    });

    log(`v2_metrics_daily upserted`);

    // ── Step 3: Derive severity ─────────────────────────────────────────────
    const severity = deriveSeverity(payments_unlinked_1d);
    log(`severity=${severity}`);

    if (severity === 'none') {
        log(`No signal threshold met — skipping signal and score.`);
        return {
            metric_date,
            payments_unlinked_1d,
            severity,
            signal_inserted: false,
            score_inserted: false,
            skipped: true,
            skip_reason: `severity=none (N=${payments_unlinked_1d})`,
        };
    }

    // ── Pre-Step 5: Idempotency Check ───────────────────────────────────────
    const { data: existSignal } = await supabaseAdmin
        .from('v2_clinical_signals')
        .select('signal_id')
        .eq('run_id', run_id)
        .eq('signal_key', 'payments_without_orders_24h')
        .limit(1)
        .maybeSingle();

    if (existSignal) {
        log(`Idempotency: signal payments_without_orders_24h already exists for run_id=${run_id}. Skipping.`);
        return {
            metric_date,
            payments_unlinked_1d,
            severity,
            signal_inserted: false,
            score_inserted: false,
            skipped: true,
            skip_reason: `idempotency: signal exists`,
        };
    }

    // ── Step 5: Insert v2_clinical_signals ─────────────────────────────────
    const evidence = {
        payments_unlinked_1d,
        window_days: 1,
        metric_date,
        sample_payment_ids: sampleIds,
    };

    const { error: signalErr } = await supabaseAdmin
        .from('v2_clinical_signals')
        .insert({
            tenant_id,
            store_id,
            run_id,
            signal_key: 'payments_without_orders_24h',
            severity,
            evidence,
            created_at: new Date().toISOString(),
        });

    if (signalErr) {
        throw new Error(`[step5] Cannot insert clinical_signal: ${signalErr.message}`);
    }

    log(`v2_clinical_signals inserted (run_id=${run_id})`);

    // ── Step 6: Insert / Upsert v2_health_scores ─────────────────────────
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
        throw new Error(`[step6] Cannot insert health_score: ${scoreErr.message}`);
    }

    log(`v2_health_scores inserted score=${newScore}`);

    // ── Engine run closing handled by orchestrator ──

    return {
        metric_date,
        payments_unlinked_1d,
        severity,
        signal_inserted: true,
        score_inserted: true,
        skipped: false,
    };
}
