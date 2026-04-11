import { supabaseAdmin } from '../lib/supabase';

interface UpsertMergedMetricsArgs {
    tenant_id: string;
    store_id: string;
    metric_date: string;
    metrics_patch: Record<string, unknown>;
}

export async function upsertMergedMetricsDaily(args: UpsertMergedMetricsArgs): Promise<void> {
    const { tenant_id, store_id, metric_date, metrics_patch } = args;

    const { error: writeErr } = await supabaseAdmin.rpc('v2_upsert_metrics_daily_merge', {
        p_tenant_id: tenant_id,
        p_store_id: store_id,
        p_metric_date: metric_date,
        p_metrics_patch: metrics_patch,
    });

    if (writeErr) {
        throw new Error(`[metrics-daily] atomic merge upsert failed: ${writeErr.message}`);
    }
}
