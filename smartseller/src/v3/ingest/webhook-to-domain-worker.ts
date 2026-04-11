import { supabaseAdmin } from '@v2/lib/supabase';
import { normalizeV3WebhookEvent } from '@/v3/ingest/domain-normalizer';

interface ClaimedWebhookRow {
    webhook_event_id: string;
}

export interface V3WebhookToDomainWorkerError {
    webhook_event_id: string;
    error: string;
}

export interface V3WebhookToDomainWorkerResult {
    scanned: number;
    claimed: number;
    processed: number;
    failed: number;
    created_domain_events: number;
    reused_domain_events: number;
    errors: V3WebhookToDomainWorkerError[];
}

function clampLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return 50;
    return Math.min(Math.floor(limit), 200);
}

function clampLeaseSeconds(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 300;
    return Math.min(Math.floor(value), 3600);
}

function formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message.trim();
    return String(error);
}

function truncate(text: string, max = 1500): string {
    return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

export async function runV3WebhookToDomainWorker(limit = 50, leaseSeconds = 300): Promise<V3WebhookToDomainWorkerResult> {
    const batchSize = clampLimit(limit);
    const lease = clampLeaseSeconds(leaseSeconds);

    const { data: claimedRows, error: claimErr } = await supabaseAdmin
        .rpc('v3_claim_webhook_events' as never, { p_limit: batchSize, p_lease_seconds: lease } as never);
    if (claimErr) throw new Error(`[v3-intake-worker] claim failed: ${claimErr.message}`);

    const claimedIds = ((claimedRows ?? []) as ClaimedWebhookRow[])
        .map((row) => row.webhook_event_id)
        .filter((id): id is string => Boolean(id));

    let processed = 0;
    let failed = 0;
    let created_domain_events = 0;
    let reused_domain_events = 0;
    const errors: V3WebhookToDomainWorkerError[] = [];

    for (const webhook_event_id of claimedIds) {
        try {
            const result = await normalizeV3WebhookEvent({ webhook_event_id });
            processed++;
            if (result.created) created_domain_events++;
            else reused_domain_events++;
        } catch (error) {
            failed++;
            const message = formatError(error);
            errors.push({ webhook_event_id, error: message });

            const { error: markErr } = await supabaseAdmin
                .from('v3_webhook_events')
                .update({
                    processing_status: 'error',
                    processing_claimed_at: null,
                    processing_error: truncate(message),
                })
                .eq('webhook_event_id', webhook_event_id);

            if (markErr) {
                console.error(
                    `[v3-intake-worker] failed to mark error for webhook_event_id=${webhook_event_id}: ${markErr.message}`
                );
            }
        }
    }

    return {
        scanned: claimedIds.length,
        claimed: claimedIds.length,
        processed,
        failed,
        created_domain_events,
        reused_domain_events,
        errors,
    };
}
