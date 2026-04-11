import { supabaseAdmin } from '@v2/lib/supabase';

export interface MaterializeV3HealthScoreInput {
    tenant_id: string;
    store_id: string;
    run_id: string;
}

export interface MaterializeV3HealthScoreResult {
    score_id: string;
    snapshot_id: string;
    score: number;
    created: boolean;
    score_payload: Record<string, unknown>;
}

type SignalSeverity = 'none' | 'info' | 'warning' | 'critical';

interface SignalRow {
    signal_key: string;
    severity: SignalSeverity;
    evidence: Record<string, unknown> | null;
}

function clampScore(value: number): number {
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
}

function toSeverity(value: unknown): SignalSeverity {
    if (value === 'critical' || value === 'warning' || value === 'info' || value === 'none') return value;
    return 'none';
}

function penaltyFor(signal: SignalRow): number {
    const weightByKey: Record<string, { warning: number; critical: number; info: number }> = {
        no_sales_7d: { info: 6, warning: 20, critical: 40 },
        cancellation_rate_spike: { info: 4, warning: 18, critical: 32 },
        unanswered_questions_24h: { info: 3, warning: 12, critical: 22 },
        active_claims_count: { info: 4, warning: 14, critical: 26 },
        shipment_delay_risk: { info: 3, warning: 12, critical: 24 },
    };

    const weights = weightByKey[signal.signal_key];
    if (!weights) return 0;
    if (signal.severity === 'critical') return weights.critical;
    if (signal.severity === 'warning') return weights.warning;
    if (signal.severity === 'info') return weights.info;
    return 0;
}

export async function materializeV3HealthScore(input: MaterializeV3HealthScoreInput): Promise<MaterializeV3HealthScoreResult> {
    const { tenant_id, store_id, run_id } = input;

    const { data: runRow, error: runErr } = await supabaseAdmin
        .from('v3_engine_runs')
        .select('run_id')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .limit(1)
        .maybeSingle<{ run_id: string }>();
    if (runErr) throw new Error(`[v3-health-score-writer] run lookup failed: ${runErr.message}`);
    if (!runRow?.run_id) throw new Error('[v3-health-score-writer] run not found');

    const { data: snapshotRow, error: snapshotErr } = await supabaseAdmin
        .from('v3_snapshots')
        .select('snapshot_id')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .limit(1)
        .maybeSingle<{ snapshot_id: string }>();
    if (snapshotErr) throw new Error(`[v3-health-score-writer] snapshot lookup failed: ${snapshotErr.message}`);
    if (!snapshotRow?.snapshot_id) throw new Error('[v3-health-score-writer] snapshot not found for run');

    const { data: rawSignalRows, error: signalsErr } = await supabaseAdmin
        .from('v3_clinical_signals')
        .select('signal_key, severity, evidence')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id);
    if (signalsErr) throw new Error(`[v3-health-score-writer] signals lookup failed: ${signalsErr.message}`);

    const businessSignalKeys = new Set([
        'no_sales_7d',
        'cancellation_rate_spike',
        'unanswered_questions_24h',
        'active_claims_count',
        'shipment_delay_risk',
    ]);

    const signalRows = (rawSignalRows ?? [])
        .map((row) => {
            const typed = row as { signal_key?: string; severity?: unknown; evidence?: Record<string, unknown> | null };
            return {
                signal_key: typed.signal_key ?? '',
                severity: toSeverity(typed.severity),
                evidence: typed.evidence ?? {},
            } as SignalRow;
        })
        .filter((row) => businessSignalKeys.has(row.signal_key));

    const penalties = signalRows
        .filter((row) => row.severity !== 'none')
        .map((row) => ({
            signal_key: row.signal_key,
            severity: row.severity,
            penalty: penaltyFor(row),
            evidence: row.evidence ?? {},
        }));

    const totalPenalty = penalties.reduce((acc, row) => acc + row.penalty, 0);
    const score = clampScore(100 - totalPenalty);

    const score_payload: Record<string, unknown> = {
        score_version: 'v3_health_score_wave2_freeze_v1',
        run_id,
        snapshot_id: snapshotRow.snapshot_id,
        formula: 'score = clamp(100 - sum(signal_penalties))',
        penalties,
        penalty_total: totalPenalty,
        signal_keys: signalRows.map((s) => s.signal_key),
        signal_count: signalRows.length,
    };

    const { data: existing, error: existingErr } = await supabaseAdmin
        .from('v3_health_scores')
        .select('score_id')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .limit(1)
        .maybeSingle<{ score_id: string }>();
    if (existingErr) throw new Error(`[v3-health-score-writer] existing score lookup failed: ${existingErr.message}`);

    const { error: upsertErr } = await supabaseAdmin
        .from('v3_health_scores')
        .upsert(
            {
                tenant_id,
                store_id,
                run_id,
                snapshot_id: snapshotRow.snapshot_id,
                score,
                score_payload,
                computed_at: new Date().toISOString(),
            },
            { onConflict: 'tenant_id,store_id,run_id' }
        );
    if (upsertErr) throw new Error(`[v3-health-score-writer] score upsert failed: ${upsertErr.message}`);

    const { data: row, error: rowErr } = await supabaseAdmin
        .from('v3_health_scores')
        .select('score_id, score, snapshot_id, score_payload')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .limit(1)
        .single<{
            score_id: string;
            score: number;
            snapshot_id: string;
            score_payload: Record<string, unknown>;
        }>();
    if (rowErr || !row?.score_id) throw new Error(`[v3-health-score-writer] score re-read failed: ${rowErr?.message ?? 'missing row'}`);

    return {
        score_id: row.score_id,
        snapshot_id: row.snapshot_id,
        score: row.score,
        score_payload: row.score_payload ?? {},
        created: !existing?.score_id,
    };
}
