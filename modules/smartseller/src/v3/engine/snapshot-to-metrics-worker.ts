import { supabaseAdmin } from '@v2/lib/supabase';
import { materializeV3MetricsDaily } from '@/v3/engine/metrics-writer';

interface ClaimedMetricsJobRow {
    job_id: string;
    tenant_id: string;
    store_id: string;
    metric_date: string;
    source_run_id: string;
    source_snapshot_id: string;
    last_source_processed_at: string;
}

export interface V3SnapshotToMetricsWorkerError {
    job_id: string;
    error: string;
}

export interface V3SnapshotToMetricsWorkerResult {
    enqueued: number;
    claimed: number;
    processed: number;
    failed: number;
    created_metrics: number;
    reused_metrics: number;
    errors: V3SnapshotToMetricsWorkerError[];
}

function clampLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return 50;
    return Math.min(Math.floor(limit), 200);
}

function clampLeaseSeconds(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 300;
    return Math.min(Math.floor(value), 3600);
}

function clampLookbackDays(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 30;
    return Math.min(Math.floor(value), 120);
}

function formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message.trim();
    return String(error);
}

function truncate(text: string, max = 1500): string {
    return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

export async function runV3SnapshotToMetricsWorker(
    limit = 50,
    leaseSeconds = 300,
    lookbackDays = 30
): Promise<V3SnapshotToMetricsWorkerResult> {
    const batchSize = clampLimit(limit);
    const lease = clampLeaseSeconds(leaseSeconds);
    const lookback = clampLookbackDays(lookbackDays);

    const { data: enqueuedCountData, error: enqueueErr } = await supabaseAdmin
        .rpc('v3_enqueue_metrics_jobs' as never, { p_lookback_days: lookback } as never);
    if (enqueueErr) throw new Error(`[v3-snapshot-metrics-worker] enqueue failed: ${enqueueErr.message}`);
    const enqueued = Number(enqueuedCountData ?? 0);

    const { data: claimedRows, error: claimErr } = await supabaseAdmin
        .rpc('v3_claim_metrics_jobs' as never, { p_limit: batchSize, p_lease_seconds: lease } as never);
    if (claimErr) throw new Error(`[v3-snapshot-metrics-worker] claim failed: ${claimErr.message}`);
    const jobs = (claimedRows ?? []) as ClaimedMetricsJobRow[];

    let processed = 0;
    let failed = 0;
    let created_metrics = 0;
    let reused_metrics = 0;
    const errors: V3SnapshotToMetricsWorkerError[] = [];

    for (const job of jobs) {
        try {
            const result = await materializeV3MetricsDaily({
                tenant_id: job.tenant_id,
                store_id: job.store_id,
                run_id: job.source_run_id,
                metric_date: job.metric_date,
            });
            if (result.created) created_metrics++;
            else reused_metrics++;

            const { error: doneErr } = await supabaseAdmin
                .from('v3_metrics_jobs')
                .update({
                    processing_status: 'processed',
                    claimed_at: null,
                    processed_at: new Date().toISOString(),
                    processing_error: null,
                })
                .eq('job_id', job.job_id);
            if (doneErr) throw new Error(`[v3-snapshot-metrics-worker] job complete update failed: ${doneErr.message}`);

            processed++;
        } catch (error) {
            failed++;
            const message = formatError(error);
            errors.push({ job_id: job.job_id, error: message });

            const { error: markErr } = await supabaseAdmin
                .from('v3_metrics_jobs')
                .update({
                    processing_status: 'error',
                    claimed_at: null,
                    processing_error: truncate(message),
                })
                .eq('job_id', job.job_id);
            if (markErr) {
                console.error(`[v3-snapshot-metrics-worker] failed to mark error for job_id=${job.job_id}: ${markErr.message}`);
            }
        }
    }

    return {
        enqueued,
        claimed: jobs.length,
        processed,
        failed,
        created_metrics,
        reused_metrics,
        errors,
    };
}
