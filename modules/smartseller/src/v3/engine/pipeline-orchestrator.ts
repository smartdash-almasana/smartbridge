import crypto from 'crypto';
import { supabaseAdmin } from '@v2/lib/supabase';
import { runV3WebhookToDomainWorker, type V3WebhookToDomainWorkerResult } from '@/v3/ingest/webhook-to-domain-worker';
import { runV3DomainToSnapshotWorker, type V3DomainToSnapshotWorkerResult } from '@/v3/engine/domain-to-snapshot-worker';
import { runV3SnapshotToMetricsWorker, type V3SnapshotToMetricsWorkerResult } from '@/v3/engine/snapshot-to-metrics-worker';
import { runV3MetricsToSignalsWorker, type V3MetricsToSignalsWorkerResult } from '@/v3/engine/metrics-to-signals-worker';
import { runV3SignalsToHealthScoreWorker, type V3SignalsToHealthScoreWorkerResult } from '@/v3/engine/signals-to-health-score-worker';

export interface RunV3PipelineOrchestratorInput {
    limit?: number;
    lease_seconds?: number;
    lookback_days?: number;
}

export interface V3RunStatusUpdateResult {
    done_marked: number;
    failed_marked: number;
    still_running: number;
    failed_candidates: number;
}

export interface V3StageDiagnostic {
    stage: 'webhook_to_domain' | 'domain_to_snapshot' | 'snapshot_to_metrics' | 'metrics_to_signals' | 'signals_to_health_score';
    duration_ms: number;
    claimed: number;
    processed: number;
    failed: number;
    enqueued?: number;
    ok: boolean;
}

export interface V3PipelineExecutionMeta {
    worker_name: 'v3-pipeline-orchestrator';
    worker_instance: string;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    status: 'ok' | 'failed';
}

export interface RunV3PipelineOrchestratorResult {
    stages: {
        webhook_to_domain: V3WebhookToDomainWorkerResult;
        domain_to_snapshot: V3DomainToSnapshotWorkerResult;
        snapshot_to_metrics: V3SnapshotToMetricsWorkerResult;
        metrics_to_signals: V3MetricsToSignalsWorkerResult;
        signals_to_health_score: V3SignalsToHealthScoreWorkerResult;
    };
    diagnostics: V3StageDiagnostic[];
    run_status: V3RunStatusUpdateResult;
    execution: V3PipelineExecutionMeta;
}

function clampLimit(limit: number | undefined): number {
    const n = Number(limit ?? 50);
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(Math.floor(n), 200);
}

function clampLeaseSeconds(value: number | undefined): number {
    const n = Number(value ?? 300);
    if (!Number.isFinite(n) || n <= 0) return 300;
    return Math.min(Math.floor(n), 3600);
}

function clampLookbackDays(value: number | undefined): number {
    const n = Number(value ?? 30);
    if (!Number.isFinite(n) || n <= 0) return 30;
    return Math.min(Math.floor(n), 120);
}

function asInt(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : 0;
}

function toIso(value: Date): string {
    return value.toISOString();
}

function stageCounters(result: unknown): { claimed: number; processed: number; failed: number; enqueued?: number } {
    const row = (result ?? {}) as Record<string, unknown>;
    const counters: { claimed: number; processed: number; failed: number; enqueued?: number } = {
        claimed: asInt(row['claimed']),
        processed: asInt(row['processed']),
        failed: asInt(row['failed']),
    };
    if (row['enqueued'] !== undefined) counters.enqueued = asInt(row['enqueued']);
    return counters;
}

async function upsertHeartbeat(args: {
    worker_instance: string;
    status: 'running' | 'ok' | 'failed';
    started_at: string;
    finished_at?: string;
    meta: Record<string, unknown>;
}): Promise<void> {
    const { error } = await supabaseAdmin
        .from('v3_worker_heartbeats')
        .upsert(
            {
                worker_name: 'v3-pipeline-orchestrator',
                worker_instance: args.worker_instance,
                status: args.status,
                started_at: args.started_at,
                finished_at: args.finished_at ?? null,
                last_seen_at: new Date().toISOString(),
                meta: args.meta,
            },
            { onConflict: 'worker_name,worker_instance' }
        );
    if (error) throw new Error(`[v3-pipeline] heartbeat upsert failed: ${error.message}`);
}

async function loadErroredRunIdsSince(sinceIso: string, cutoffDate: string): Promise<string[]> {
    const runIds = new Set<string>();

    const { data: snapshotRows, error: snapshotErr } = await supabaseAdmin
        .from('v3_snapshot_jobs')
        .select('run_id')
        .eq('processing_status', 'error')
        .not('run_id', 'is', null)
        .gte('updated_at', sinceIso)
        .gte('metric_date', cutoffDate);
    if (snapshotErr) throw new Error(`[v3-pipeline] failed runs from snapshot_jobs failed: ${snapshotErr.message}`);
    for (const row of snapshotRows ?? []) {
        const runId = (row as { run_id?: string }).run_id;
        if (runId) runIds.add(runId);
    }

    const jobTables = ['v3_metrics_jobs', 'v3_signals_jobs', 'v3_scores_jobs'] as const;
    for (const tableName of jobTables) {
        const { data, error } = await supabaseAdmin
            .from(tableName)
            .select('source_run_id')
            .eq('processing_status', 'error')
            .gte('updated_at', sinceIso)
            .gte('metric_date', cutoffDate);
        if (error) throw new Error(`[v3-pipeline] failed runs from ${tableName} failed: ${error.message}`);
        for (const row of data ?? []) {
            const runId = (row as { source_run_id?: string }).source_run_id;
            if (runId) runIds.add(runId);
        }
    }

    return Array.from(runIds);
}

async function markRunStatuses(lookbackDays: number, executionStartedAtIso: string): Promise<V3RunStatusUpdateResult> {
    const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: scoreRuns, error: scoreRunsErr } = await supabaseAdmin
        .from('v3_health_scores')
        .select('run_id')
        .gte('computed_at', `${cutoffDate}T00:00:00.000Z`);
    if (scoreRunsErr) throw new Error(`[v3-pipeline] load score runs failed: ${scoreRunsErr.message}`);

    const runIds = Array.from(
        new Set(
            (scoreRuns ?? [])
                .map((row) => (row as { run_id?: string }).run_id)
                .filter((id): id is string => Boolean(id))
        )
    );

    let done_marked = 0;
    if (runIds.length > 0) {
        const { data: updatedRows, error: updateErr } = await supabaseAdmin
            .from('v3_engine_runs')
            .update({
                status: 'done',
                finished_at: new Date().toISOString(),
            })
            .in('status', ['running', 'failed'])
            .in('run_id', runIds)
            .select('run_id');
        if (updateErr) throw new Error(`[v3-pipeline] mark done failed: ${updateErr.message}`);
        done_marked = (updatedRows ?? []).length;
    }

    const erroredRunIds = await loadErroredRunIdsSince(executionStartedAtIso, cutoffDate);
    let failed_marked = 0;
    if (erroredRunIds.length > 0) {
        const healthyRunIds = new Set(runIds);
        const failedCandidates = erroredRunIds.filter((id) => !healthyRunIds.has(id));
        if (failedCandidates.length > 0) {
            const { data: failedRows, error: failedErr } = await supabaseAdmin
                .from('v3_engine_runs')
                .update({
                    status: 'failed',
                    finished_at: new Date().toISOString(),
                })
                .eq('status', 'running')
                .in('run_id', failedCandidates)
                .select('run_id');
            if (failedErr) throw new Error(`[v3-pipeline] mark failed failed: ${failedErr.message}`);
            failed_marked = (failedRows ?? []).length;
        }
    }

    const { count: still_running, error: runningErr } = await supabaseAdmin
        .from('v3_engine_runs')
        .select('run_id', { count: 'exact', head: true })
        .eq('status', 'running')
        .gte('metric_date', cutoffDate);
    if (runningErr) throw new Error(`[v3-pipeline] running count failed: ${runningErr.message}`);

    return {
        done_marked,
        failed_marked,
        still_running: still_running ?? 0,
        failed_candidates: erroredRunIds.length,
    };
}

export async function runV3PipelineOrchestrator(
    input: RunV3PipelineOrchestratorInput = {}
): Promise<RunV3PipelineOrchestratorResult> {
    const limit = clampLimit(input.limit);
    const lease = clampLeaseSeconds(input.lease_seconds);
    const lookback = clampLookbackDays(input.lookback_days);
    const worker_instance = `${process.env.VERCEL_REGION ?? 'local'}:${crypto.randomUUID()}`;
    const startedAt = new Date();
    const started_at = toIso(startedAt);
    const diagnostics: V3StageDiagnostic[] = [];

    await upsertHeartbeat({
        worker_instance,
        status: 'running',
        started_at,
        meta: {
            params: { limit, lease_seconds: lease, lookback_days: lookback },
        },
    });

    try {
        const t1 = Date.now();
        const webhookToDomain = await runV3WebhookToDomainWorker(limit, lease);
        diagnostics.push({
            stage: 'webhook_to_domain',
            duration_ms: Date.now() - t1,
            ...stageCounters(webhookToDomain),
            ok: webhookToDomain.failed === 0,
        });

        const t2 = Date.now();
        const domainToSnapshot = await runV3DomainToSnapshotWorker(limit, lease, lookback);
        diagnostics.push({
            stage: 'domain_to_snapshot',
            duration_ms: Date.now() - t2,
            ...stageCounters(domainToSnapshot),
            ok: domainToSnapshot.failed === 0,
        });

        const t3 = Date.now();
        const snapshotToMetrics = await runV3SnapshotToMetricsWorker(limit, lease, lookback);
        diagnostics.push({
            stage: 'snapshot_to_metrics',
            duration_ms: Date.now() - t3,
            ...stageCounters(snapshotToMetrics),
            ok: snapshotToMetrics.failed === 0,
        });

        const t4 = Date.now();
        const metricsToSignals = await runV3MetricsToSignalsWorker(limit, lease, lookback);
        diagnostics.push({
            stage: 'metrics_to_signals',
            duration_ms: Date.now() - t4,
            ...stageCounters(metricsToSignals),
            ok: metricsToSignals.failed === 0,
        });

        const t5 = Date.now();
        const signalsToHealthScore = await runV3SignalsToHealthScoreWorker(limit, lease, lookback);
        diagnostics.push({
            stage: 'signals_to_health_score',
            duration_ms: Date.now() - t5,
            ...stageCounters(signalsToHealthScore),
            ok: signalsToHealthScore.failed === 0,
        });

        const runStatus = await markRunStatuses(lookback, started_at);
        const finishedAt = new Date();
        const finished_at = toIso(finishedAt);
        const duration_ms = finishedAt.getTime() - startedAt.getTime();

        await upsertHeartbeat({
            worker_instance,
            status: 'ok',
            started_at,
            finished_at,
            meta: {
                params: { limit, lease_seconds: lease, lookback_days: lookback },
                diagnostics,
                run_status: runStatus,
            },
        });

        return {
            stages: {
                webhook_to_domain: webhookToDomain,
                domain_to_snapshot: domainToSnapshot,
                snapshot_to_metrics: snapshotToMetrics,
                metrics_to_signals: metricsToSignals,
                signals_to_health_score: signalsToHealthScore,
            },
            diagnostics,
            run_status: runStatus,
            execution: {
                worker_name: 'v3-pipeline-orchestrator',
                worker_instance,
                started_at,
                finished_at,
                duration_ms,
                status: 'ok',
            },
        };
    } catch (error) {
        const finishedAt = new Date();
        const finished_at = toIso(finishedAt);
        const duration_ms = finishedAt.getTime() - startedAt.getTime();
        const message = error instanceof Error ? error.message : String(error);

        await upsertHeartbeat({
            worker_instance,
            status: 'failed',
            started_at,
            finished_at,
            meta: {
                params: { limit, lease_seconds: lease, lookback_days: lookback },
                diagnostics,
                error: message,
            },
        });

        throw new Error(`[v3-pipeline] ${message}`);
    }
}
