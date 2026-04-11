// ============================================================================
// SmartSeller V2 — Zero Price Items Metrics Worker (Phase 3.A3)
// Responsibility: compute zero_price_items_1d → upsert v2_metrics_daily,
//                derive zero_price_items_24h → insert v2_clinical_signals,
//                update v2_health_scores via run_id.
// Scope: 1 metric + 1 signal + 1 score. No writes to other tables.
// No app code, no UI, no external APIs.
// ============================================================================

import { supabaseAdmin } from '../lib/supabase';
import { readSnapshotClinicalInputs } from './snapshot-clinical-inputs';
import { upsertMergedMetricsDaily } from './metrics-daily-writer';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ZeroPriceItemsInput {
    tenant_id: string;
    store_id: string;
    metric_date: string; // 'YYYY-MM-DD' UTC
    run_id: string;
}

export interface ZeroPriceItemsResult {
    metric_date: string;
    zero_price_items_1d: number;
    severity: 'none' | 'info' | 'warning' | 'critical';
    signal_inserted: boolean;
    score_inserted: boolean;
    skipped: boolean;
    skip_reason?: string;
}

// ── Severity derivation (DB enum: info | warning | critical) ───────────────

function deriveSeverity(n: number): 'none' | 'info' | 'warning' | 'critical' {
    if (n >= 20) return 'critical';
    if (n >= 5) return 'warning';
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

export async function runZeroPriceItemsWorker(
    input: ZeroPriceItemsInput
): Promise<ZeroPriceItemsResult> {
    const { tenant_id, store_id, metric_date, run_id } = input;
    const log = (msg: string) => console.log(`[zero-price-items-worker] ${msg}`);

    // ── Step 1: Read metric input from canonical snapshot payload ──────────────
    const snapshotInputs = await readSnapshotClinicalInputs({ tenant_id, store_id, run_id });
    const zero_price_items_1d = snapshotInputs.zero_price_items_1d;
    const sampleItems = snapshotInputs.zero_price_sample_items.slice(0, 20);

    log(`zero_price_items_1d=${zero_price_items_1d} for store=${store_id} date=${metric_date}`);

    // ── Step 2: Upsert v2_metrics_daily ────────────────────────────────────
    await upsertMergedMetricsDaily({
        tenant_id,
        store_id,
        metric_date,
        metrics_patch: { zero_price_items_1d },
    });

    log(`v2_metrics_daily upserted`);

    // ── Step 3: Derive severity ─────────────────────────────────────────────
    const severity = deriveSeverity(zero_price_items_1d);
    log(`severity=${severity}`);

    if (severity === 'none') {
        log(`No signal threshold met — skipping signal and score.`);
        return {
            metric_date,
            zero_price_items_1d,
            severity,
            signal_inserted: false,
            score_inserted: false,
            skipped: true,
            skip_reason: `severity=none (N=${zero_price_items_1d})`,
        };
    }

    // ── Pre-Step 5: Idempotency Check ───────────────────────────────────────
    const { data: existSignal } = await supabaseAdmin
        .from('v2_clinical_signals')
        .select('signal_id')
        .eq('run_id', run_id)
        .eq('signal_key', 'zero_price_items_24h')
        .limit(1)
        .maybeSingle();

    if (existSignal) {
        log(`Idempotency: signal zero_price_items_24h already exists for run_id=${run_id}. Skipping.`);
        return {
            metric_date,
            zero_price_items_1d,
            severity,
            signal_inserted: false,
            score_inserted: false,
            skipped: true,
            skip_reason: `idempotency: signal exists`,
        };
    }

    // ── Step 5: Insert v2_clinical_signals ─────────────────────────────────
    const evidence = {
        zero_price_items_1d,
        window_days: 1,
        metric_date,
        sample_items: sampleItems,
    };

    const { error: signalErr } = await supabaseAdmin
        .from('v2_clinical_signals')
        .insert({
            tenant_id,
            store_id,
            run_id,
            signal_key: 'zero_price_items_24h',
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
        zero_price_items_1d,
        severity,
        signal_inserted: true,
        score_inserted: true,
        skipped: false,
    };
}
