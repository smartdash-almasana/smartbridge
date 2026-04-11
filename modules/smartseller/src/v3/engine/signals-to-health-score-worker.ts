import { supabaseAdmin } from '@v2/lib/supabase';
import { materializeV3HealthScore } from '@/v3/engine/health-score-writer';

interface ClaimedScoresJobRow {
    job_id: string;
    tenant_id: string;
    store_id: string;
    metric_date: string;
    source_run_id: string;
    source_snapshot_id: string;
    last_source_processed_at: string;
}

export interface V3SignalsToHealthScoreWorkerError {
    job_id: string;
    error: string;
}

export interface V3SignalsToHealthScoreWorkerResult {
    enqueued: number;
    claimed: number;
    processed: number;
    failed: number;
    created_scores: number;
    reused_scores: number;
    errors: V3SignalsToHealthScoreWorkerError[];
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

export async function runV3SignalsToHealthScoreWorker(
    limit = 50,
    leaseSeconds = 300,
    lookbackDays = 30
): Promise<V3SignalsToHealthScoreWorkerResult> {
    const batchSize = clampLimit(limit);
    const lease = clampLeaseSeconds(leaseSeconds);
    const lookback = clampLookbackDays(lookbackDays);

    const { data: enqueuedCountData, error: enqueueErr } = await supabaseAdmin
        .rpc('v3_enqueue_scores_jobs' as never, { p_lookback_days: lookback } as never);
    if (enqueueErr) throw new Error(`[v3-signals-score-worker] enqueue failed: ${enqueueErr.message}`);
    const enqueued = Number(enqueuedCountData ?? 0);

    const { data: claimedRows, error: claimErr } = await supabaseAdmin
        .rpc('v3_claim_scores_jobs' as never, { p_limit: batchSize, p_lease_seconds: lease } as never);
    if (claimErr) throw new Error(`[v3-signals-score-worker] claim failed: ${claimErr.message}`);
    const jobs = (claimedRows ?? []) as ClaimedScoresJobRow[];

    let processed = 0;
    let failed = 0;
    let created_scores = 0;
    let reused_scores = 0;
    const errors: V3SignalsToHealthScoreWorkerError[] = [];

    for (const job of jobs) {
        try {
            const result = await materializeV3HealthScore({
                tenant_id: job.tenant_id,
                store_id: job.store_id,
                run_id: job.source_run_id,
            });

            if (result.created) created_scores++;
            else reused_scores++;

            const { error: doneErr } = await supabaseAdmin
                .from('v3_scores_jobs')
                .update({
                    processing_status: 'processed',
                    claimed_at: null,
                    processed_at: new Date().toISOString(),
                    processing_error: null,
                    score_id: result.score_id,
                })
                .eq('job_id', job.job_id);
            if (doneErr) throw new Error(`[v3-signals-score-worker] job complete update failed: ${doneErr.message}`);

            processed++;
        } catch (error) {
            failed++;
            const message = formatError(error);
            errors.push({ job_id: job.job_id, error: message });

            const { error: markErr } = await supabaseAdmin
                .from('v3_scores_jobs')
                .update({
                    processing_status: 'error',
                    claimed_at: null,
                    processing_error: truncate(message),
                })
                .eq('job_id', job.job_id);
            if (markErr) {
                console.error(`[v3-signals-score-worker] failed to mark error for job_id=${job.job_id}: ${markErr.message}`);
            }
        }
    }

    return {
        enqueued,
        claimed: jobs.length,
        processed,
        failed,
        created_scores,
        reused_scores,
        errors,
    };
}
