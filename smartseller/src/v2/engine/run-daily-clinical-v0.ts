// ============================================================================
// SmartSeller V2 — Daily Clinical Orchestrator (Phase 3.A4)
// Responsibility: create a single engine_run for the day and sequentially execute
//                all clinical workers (refunds, payments, zero_price_items).
// Scope: Orchestrates smaller domain workers.
// No app code, no UI, no external APIs.
// ============================================================================

import { supabaseAdmin } from '../lib/supabase';
import crypto from 'crypto';
import { runRefundMetricsWorker } from './refund-metrics-worker';
import { runPaymentsUnlinkedWorker } from './payments-unlinked-worker';
import { runZeroPriceItemsWorker } from './zero-price-items-worker';
import { seedSnapshotClinicalInputs } from './snapshot-clinical-inputs';

export interface DailyClinicalInput {
    tenant_id: string;
    store_id: string;
    metric_date?: string; // Optional: defaults to today if not provided
}

async function ensureSnapshotForRun(args: {
    tenant_id: string;
    store_id: string;
    run_id: string;
    metric_date: string;
    results?: Record<string, unknown>;
}): Promise<string> {
    const { tenant_id, store_id, run_id, metric_date, results } = args;

    const { data: existingSnapshot, error: existingSnapshotErr } = await supabaseAdmin
        .from('v2_snapshots')
        .select('snapshot_id')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .order('snapshot_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ snapshot_id: string }>();

    if (existingSnapshotErr) {
        throw new Error(`snapshot lookup failed: ${existingSnapshotErr.message}`);
    }

    let snapshot_id = existingSnapshot?.snapshot_id;

    const [{ data: metricsRows, error: metricsErr }, { data: signalsRows, error: signalsErr }, { data: scoreRow, error: scoreErr }] = await Promise.all([
        supabaseAdmin
            .from('v2_metrics_daily')
            .select('metric_date, metrics')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .eq('metric_date', metric_date)
            .limit(1),
        supabaseAdmin
            .from('v2_clinical_signals')
            .select('signal_id, signal_key, severity, evidence, created_at')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .eq('run_id', run_id)
            .order('created_at', { ascending: true }),
        supabaseAdmin
            .from('v2_health_scores')
            .select('score, computed_at')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .eq('run_id', run_id)
            .limit(1)
            .maybeSingle(),
    ]);

    if (metricsErr) throw new Error(`snapshot metrics read failed: ${metricsErr.message}`);
    if (signalsErr) throw new Error(`snapshot signals read failed: ${signalsErr.message}`);
    if (scoreErr) throw new Error(`snapshot score read failed: ${scoreErr.message}`);

    const payloadPatch = {
        metric_date,
        worker_results: results ?? null,
        metrics_daily: metricsRows ?? [],
        clinical_signals: signalsRows ?? [],
        health_score: scoreRow ?? null,
    };

    if (!snapshot_id) {
        const { data: insertedSnapshot, error: insertSnapshotErr } = await supabaseAdmin
            .from('v2_snapshots')
            .insert({
                tenant_id,
                store_id,
                run_id,
                snapshot_at: new Date().toISOString(),
                payload: payloadPatch,
            })
            .select('snapshot_id')
            .single<{ snapshot_id: string }>();

        if (insertSnapshotErr || !insertedSnapshot) {
            throw new Error(`snapshot insert failed: ${insertSnapshotErr?.message ?? 'unknown error'}`);
        }
        snapshot_id = insertedSnapshot.snapshot_id;
    } else {
        const { data: existingSnapshotRow, error: existingPayloadErr } = await supabaseAdmin
            .from('v2_snapshots')
            .select('payload')
            .eq('snapshot_id', snapshot_id)
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .maybeSingle<{ payload: Record<string, unknown> | null }>();
        if (existingPayloadErr) throw new Error(`snapshot payload lookup failed: ${existingPayloadErr.message}`);

        const mergedPayload = {
            ...(existingSnapshotRow?.payload ?? {}),
            ...payloadPatch,
        };
        const { error: payloadUpdateErr } = await supabaseAdmin
            .from('v2_snapshots')
            .update({ payload: mergedPayload })
            .eq('snapshot_id', snapshot_id)
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id);
        if (payloadUpdateErr) throw new Error(`snapshot payload update failed: ${payloadUpdateErr.message}`);
    }

    const { error: signalsLinkErr } = await supabaseAdmin
        .from('v2_clinical_signals')
        .update({ snapshot_id })
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id);
    if (signalsLinkErr) throw new Error(`snapshot link to signals failed: ${signalsLinkErr.message}`);

    const { error: scoreLinkErr } = await supabaseAdmin
        .from('v2_health_scores')
        .update({ snapshot_id })
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id);
    if (scoreLinkErr) throw new Error(`snapshot link to health_score failed: ${scoreLinkErr.message}`);

    return snapshot_id;
}

export async function runDailyClinicalV0(input: DailyClinicalInput) {
    const { tenant_id, store_id } = input;
    const metric_date = input.metric_date || new Date().toISOString().slice(0, 10);
    const log = (msg: string) => console.log(`[clinical-orchestrator][${store_id}][${metric_date}] ${msg}`);

    log('Starting daily clinical run...');

    // ── 1. Check existing run for today ────────────────────────────────────
    const dayStart = `${metric_date}T00:00:00.000Z`;
    const dayEnd = `${metric_date}T23:59:59.999Z`;

    const { data: existingRun } = await supabaseAdmin
        .from('v2_engine_runs')
        .select('run_id, status')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .gte('started_at', dayStart)
        .lte('started_at', dayEnd)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    let run_id: string;

    if (existingRun) {
        run_id = existingRun.run_id;
        log(`Found existing engine_run for today: ${run_id}`);

        // Orquestador: si detecta que el run_id ya tiene señales, puede devolver early con resumen
        const { data: signals } = await supabaseAdmin
            .from('v2_clinical_signals')
            .select('signal_id')
            .eq('run_id', run_id)
            .limit(1);

        if (signals && signals.length > 0) {
            const snapshot_id = await ensureSnapshotForRun({
                tenant_id,
                store_id,
                run_id,
                metric_date,
                results: {}
            });
            log(`Run ${run_id} already has signals. Returning early with snapshot ${snapshot_id}.`);
            return {
                success: true,
                run_id,
                snapshot_id,
                early_return: true,
                reason: 'Run already has signals',
                results: {}
            };
        }
    } else {
        const { data: runRow, error: runErr } = await supabaseAdmin
            .from('v2_engine_runs')
            .insert({
                tenant_id,
                store_id,
                status: 'running',
                started_at: new Date().toISOString(),
            })
            .select('run_id')
            .single();

        if (runErr || !runRow) {
            throw new Error(`Orchestrator failed to create engine_run: ${runErr?.message}`);
        }
        run_id = runRow.run_id;
        log(`Created engine_run: ${run_id}`);
    }

    const results: Record<string, any> = {};

    try {
        // ── 2. Seed canonical snapshot inputs for this run ──────────────────────
        const seeded = await seedSnapshotClinicalInputs({ tenant_id, store_id, run_id, metric_date });
        results.snapshot_inputs = seeded.clinical_inputs;

        // ── 3. Run Workers sequentially ─────────────────────────────────────────

        // Worker: Refunds
        log(`Running refund metrics worker...`);
        results.refunds = await runRefundMetricsWorker({ tenant_id, store_id, metric_date, run_id });

        // Worker: Payments
        log(`Running unlinked payments worker...`);
        results.payments = await runPaymentsUnlinkedWorker({ tenant_id, store_id, metric_date, run_id });

        // Worker: Zero Price Items
        log(`Running zero price items worker...`);
        results.zero_price = await runZeroPriceItemsWorker({ tenant_id, store_id, metric_date, run_id });

        // ── 4. Persist canonical snapshot for this run ──────────────────────────
        const snapshot_id = await ensureSnapshotForRun({
            tenant_id,
            store_id,
            run_id,
            metric_date,
            results,
        });

        // ── 5. Close engine_run on Success ──────────────────────────────────────
        const { error: doneErr } = await supabaseAdmin
            .from('v2_engine_runs')
            .update({ status: 'done', finished_at: new Date().toISOString() })
            .eq('run_id', run_id);

        if (doneErr) {
            log(`Warning: Failed to gracefully close engine_run: ${doneErr.message}`);
        }

        log(`Daily clinical run completed successfully`);
        return { success: true, run_id, snapshot_id, results };

    } catch (error: any) {
        log(`ERROR during clinical run: ${error.message}`);

        try {
            const snapshot_id = await ensureSnapshotForRun({
                tenant_id,
                store_id,
                run_id,
                metric_date,
                results,
            });
            log(`Failure-path snapshot linkage completed for run ${run_id} with snapshot ${snapshot_id}.`);
        } catch (snapshotErr: any) {
            log(`Warning: failure-path snapshot linkage failed: ${snapshotErr?.message ?? String(snapshotErr)}`);
        }

        // ── 4. Force failure status on engine_run ──────────────────────────────
        await supabaseAdmin
            .from('v2_engine_runs')
            .update({ status: 'failed', finished_at: new Date().toISOString() })
            .eq('run_id', run_id);

        // Send to DLQ
        const dedupe_raw = `${tenant_id}|${store_id}|clinical_v0|${metric_date}|${run_id}`;
        const dedupe_key = crypto.createHash('sha256').update(dedupe_raw).digest('hex');

        await supabaseAdmin.from('v2_dlq_events').upsert({
            tenant_id,
            store_id,
            provider_key: 'system', // Clinical orchestrator is system-level
            source: 'clinical_orchestrator',
            event_type: 'daily_run_failed',
            external_id: run_id,
            dedupe_key,
            raw_event: { input, partial_results: results },
            error_code: error.code || 'CLINICAL_ERROR',
            error_detail: error.message || String(error)
        }, { onConflict: 'dedupe_key', ignoreDuplicates: true });

        return { success: false, run_id, error: error.message, partial_results: results };
    }
}
