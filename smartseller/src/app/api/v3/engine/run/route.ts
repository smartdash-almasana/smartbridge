import { ensureV3EngineRun } from '@/v3/engine/run-writer';
import { materializeV3MetricsDaily } from '@/v3/engine/metrics-writer';
import { materializeV3ClinicalSignals } from '@/v3/engine/signals-writer';
import { materializeV3HealthScore } from '@/v3/engine/health-score-writer';
import { ensureV3Snapshot } from '@/v3/engine/snapshot-writer';
import { supabaseAdmin } from '@v2/lib/supabase';

interface V3EngineRunRequestBody {
    tenant_id?: string;
    store_id?: string;
    metric_date?: string;
}

function isBlockedSeedUuid(value: string): boolean {
    return value === '11111111-4444-4111-8111-111111111111' || value.startsWith('22222222-');
}

function isoDayBounds(metricDate: string): { startIso: string; endIso: string } {
    const startIso = `${metricDate}T00:00:00.000Z`;
    const startMs = Date.parse(startIso);
    if (!Number.isFinite(startMs)) {
        throw new Error(`[v3-engine-run] invalid metric_date: ${metricDate}`);
    }
    const endIso = new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
    return { startIso, endIso };
}

async function loadClinicalInputs(tenant_id: string, store_id: string, metricDate: string): Promise<Record<string, unknown>> {
    const { startIso, endIso } = isoDayBounds(metricDate);
    const { data, error } = await supabaseAdmin
        .from('v3_domain_events')
        .select('event_type,source_webhook_event_id')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .gte('occurred_at', startIso)
        .lt('occurred_at', endIso);
    if (error) throw new Error(`[v3-engine-run] domain_events read failed: ${error.message}`);

    let ordersCreated1d = 0;
    const webhookIds = new Set<string>();
    for (const row of data ?? []) {
        const eventType = (row as { event_type?: string }).event_type ?? '';
        const webhookId = (row as { source_webhook_event_id?: string }).source_webhook_event_id ?? '';
        if (eventType === 'order.created') ordersCreated1d++;
        if (webhookId) webhookIds.add(webhookId);
    }

    return {
        source_webhook_events_1d: webhookIds.size,
        source_domain_events_1d: (data ?? []).length,
        orders_created_1d: ordersCreated1d,
    };
}

export async function POST(request: Request) {
    try {
        if ((process.env.V3_REPAIR_FREEZE ?? '').trim() === '1') {
            return Response.json({ ok: false, error: 'V3 repair freeze enabled' }, { status: 503 });
        }

        const body = (await request.json()) as V3EngineRunRequestBody;
        const tenant_id = (body.tenant_id ?? '').trim();
        const store_id = (body.store_id ?? '').trim();
        const metric_date = body.metric_date?.trim();

        if (!tenant_id) return Response.json({ ok: false, error: 'Missing tenant_id' }, { status: 400 });
        if (!store_id) return Response.json({ ok: false, error: 'Missing store_id' }, { status: 400 });
        if (isBlockedSeedUuid(tenant_id) || isBlockedSeedUuid(store_id)) {
            return Response.json({ ok: false, error: 'Seed/test UUID blocked in V3 engine run endpoint' }, { status: 422 });
        }

        const runResult = await ensureV3EngineRun({
            tenant_id,
            store_id,
            metric_date,
        });
        const clinicalInputs = await loadClinicalInputs(tenant_id, store_id, runResult.metric_date);

        const snapshotResult = await ensureV3Snapshot({
            tenant_id,
            store_id,
            run_id: runResult.run_id,
            payload: {
                source: 'v3_engine_run_domain_aggregate',
                metric_date: runResult.metric_date,
                clinical_inputs: clinicalInputs,
                seeded_at: new Date().toISOString(),
            },
        });

        const metricsResult = await materializeV3MetricsDaily({
            tenant_id,
            store_id,
            run_id: runResult.run_id,
            metric_date: runResult.metric_date,
        });

        const signalsResult = await materializeV3ClinicalSignals({
            tenant_id,
            store_id,
            run_id: runResult.run_id,
            metric_date: runResult.metric_date,
        });

        const healthScoreResult = await materializeV3HealthScore({
            tenant_id,
            store_id,
            run_id: runResult.run_id,
        });

        return Response.json(
            {
                ok: true,
                run_id: runResult.run_id,
                run_created: runResult.created,
                snapshot_id: snapshotResult.snapshot_id,
                snapshot_created: snapshotResult.created,
                metric_date: runResult.metric_date,
                metrics_created: metricsResult.created,
                metrics: metricsResult.metrics,
                signals_created: signalsResult.created_count,
                signals: signalsResult.signals,
                health_score_id: healthScoreResult.score_id,
                health_score_created: healthScoreResult.created,
                health_score: healthScoreResult.score,
                health_score_payload: healthScoreResult.score_payload,
            },
            { status: 200 }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ ok: false, error: message }, { status: 500 });
    }
}
