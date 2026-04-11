import { supabaseAdmin } from '@v2/lib/supabase';

type SignalSeverity = 'none' | 'info' | 'warning' | 'critical';
type HealthBand = 'healthy' | 'warning' | 'critical' | null;
type FreshnessStatus = 'fresh' | 'stale' | 'outdated' | 'empty';

interface StoreRow {
    tenant_id: string;
    store_id: string;
    seller_uuid: string;
    provider_key: string;
    status: string;
}

interface EngineRunRow {
    run_id: string;
    metric_date: string;
    status: 'running' | 'done' | 'failed';
    started_at: string;
    finished_at: string | null;
}

interface HealthScoreRow {
    score_id: string;
    run_id: string;
    snapshot_id: string;
    score: number;
    computed_at: string;
    score_payload: Record<string, unknown> | null;
}

interface SignalRow {
    signal_key: string;
    severity: SignalSeverity;
    evidence: Record<string, unknown> | null;
    created_at: string;
}

interface MetricsRow {
    metric_date: string;
    run_id: string;
    snapshot_id: string;
    computed_at: string;
    metrics: Record<string, unknown> | null;
}

interface SnapshotRow {
    snapshot_id: string;
    snapshot_at: string;
    payload: Record<string, unknown> | null;
}

export class V3ClinicalStatusStoreNotFoundError extends Error {
    code = 'STORE_NOT_FOUND' as const;

    constructor() {
        super('[v3-clinical-status] store not found');
        this.name = 'V3ClinicalStatusStoreNotFoundError';
    }
}

export interface V3ClinicalStatusResponse {
    tenant_id: string;
    store_id: string;
    seller_uuid: string;
    provider_key: string;
    store_status: string;
    active_run_id: string | null;
    latest_health_score: number | null;
    severity_band: HealthBand;
    computed_at: string | null;
    active_clinical_signals: Array<{
        signal_key: string;
        severity: SignalSeverity;
        evidence: Record<string, unknown>;
        created_at: string;
    }>;
    summarized_metrics: Record<string, unknown>;
    minimal_evidence: {
        score_payload: Record<string, unknown>;
        top_signal_keys: string[];
        latest_snapshot_summary: Record<string, unknown>;
    };
    freshness: {
        status: FreshnessStatus;
        age_seconds: number | null;
        metric_date: string | null;
        run_status: EngineRunRow['status'] | null;
    };
}

function asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function bandFromScore(score: number | null): HealthBand {
    if (score === null || !Number.isFinite(score)) return null;
    if (score >= 85) return 'healthy';
    if (score >= 60) return 'warning';
    return 'critical';
}

function freshnessFromComputedAt(computedAt: string | null): { status: FreshnessStatus; age_seconds: number | null } {
    if (!computedAt) return { status: 'empty', age_seconds: null };

    const ts = Date.parse(computedAt);
    if (!Number.isFinite(ts)) return { status: 'empty', age_seconds: null };

    const ageSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (ageSeconds <= 6 * 60 * 60) return { status: 'fresh', age_seconds: ageSeconds };
    if (ageSeconds <= 24 * 60 * 60) return { status: 'stale', age_seconds: ageSeconds };
    return { status: 'outdated', age_seconds: ageSeconds };
}

function severityRank(severity: SignalSeverity): number {
    switch (severity) {
        case 'critical':
            return 4;
        case 'warning':
            return 3;
        case 'info':
            return 2;
        default:
            return 1;
    }
}

export async function readV3ClinicalStatus(args: {
    tenant_id: string;
    store_id: string;
}): Promise<V3ClinicalStatusResponse> {
    const { tenant_id, store_id } = args;

    const { data: store, error: storeErr } = await supabaseAdmin
        .from('v3_stores')
        .select('tenant_id,store_id,seller_uuid,provider_key,status')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .limit(1)
        .maybeSingle<StoreRow>();
    if (storeErr) throw new Error(`[v3-clinical-status] store lookup failed: ${storeErr.message}`);
    if (!store) throw new V3ClinicalStatusStoreNotFoundError();

    const { data: latestRun, error: runErr } = await supabaseAdmin
        .from('v3_engine_runs')
        .select('run_id,metric_date,status,started_at,finished_at')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle<EngineRunRow>();
    if (runErr) throw new Error(`[v3-clinical-status] engine_run lookup failed: ${runErr.message}`);

    const { data: latestScore, error: scoreErr } = await supabaseAdmin
        .from('v3_health_scores')
        .select('score_id,run_id,snapshot_id,score,computed_at,score_payload')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle<HealthScoreRow>();
    if (scoreErr) throw new Error(`[v3-clinical-status] health_score lookup failed: ${scoreErr.message}`);

    let activeRunRow: EngineRunRow | null = null;
    if (latestScore?.run_id) {
        if (latestRun?.run_id === latestScore.run_id) {
            activeRunRow = latestRun;
        } else {
            const { data, error } = await supabaseAdmin
                .from('v3_engine_runs')
                .select('run_id,metric_date,status,started_at,finished_at')
                .eq('tenant_id', tenant_id)
                .eq('store_id', store_id)
                .eq('run_id', latestScore.run_id)
                .limit(1)
                .maybeSingle<EngineRunRow>();
            if (error) throw new Error(`[v3-clinical-status] active engine_run lookup failed: ${error.message}`);
            activeRunRow = data ?? null;
        }
    } else {
        activeRunRow = latestRun ?? null;
    }

    const activeRunId = activeRunRow?.run_id ?? null;
    const activeMetricDate = activeRunRow?.metric_date ?? null;

    const [signalsResp, metricsResp, snapshotResp] = await Promise.all([
        activeRunId
            ? supabaseAdmin
                .from('v3_clinical_signals')
                .select('signal_key,severity,evidence,created_at')
                .eq('tenant_id', tenant_id)
                .eq('store_id', store_id)
                .eq('run_id', activeRunId)
            : Promise.resolve({ data: [], error: null }),
        activeMetricDate
            ? supabaseAdmin
                .from('v3_metrics_daily')
                .select('metric_date,run_id,snapshot_id,computed_at,metrics')
                .eq('tenant_id', tenant_id)
                .eq('store_id', store_id)
                .eq('run_id', activeRunId)
                .eq('metric_date', activeMetricDate)
                .limit(1)
                .maybeSingle<MetricsRow>()
            : Promise.resolve({ data: null, error: null }),
        latestScore?.snapshot_id
            ? supabaseAdmin
                .from('v3_snapshots')
                .select('snapshot_id,snapshot_at,payload')
                .eq('tenant_id', tenant_id)
                .eq('store_id', store_id)
                .eq('snapshot_id', latestScore.snapshot_id)
                .limit(1)
                .maybeSingle<SnapshotRow>()
            : activeRunId
                ? supabaseAdmin
                    .from('v3_snapshots')
                    .select('snapshot_id,snapshot_at,payload')
                    .eq('tenant_id', tenant_id)
                    .eq('store_id', store_id)
                    .eq('run_id', activeRunId)
                    .limit(1)
                    .maybeSingle<SnapshotRow>()
                : Promise.resolve({ data: null, error: null }),
    ]);

    if (signalsResp.error) throw new Error(`[v3-clinical-status] clinical_signals lookup failed: ${signalsResp.error.message}`);
    if (metricsResp.error) throw new Error(`[v3-clinical-status] metrics lookup failed: ${metricsResp.error.message}`);
    if (snapshotResp.error) throw new Error(`[v3-clinical-status] snapshot lookup failed: ${snapshotResp.error.message}`);

    const signalRows = ((signalsResp.data ?? []) as SignalRow[])
        .filter((row) => row.severity !== 'none')
        .sort((a, b) => {
            const severityDelta = severityRank(b.severity) - severityRank(a.severity);
            if (severityDelta !== 0) return severityDelta;
            return Date.parse(b.created_at) - Date.parse(a.created_at);
        });

    const metricsRow = (metricsResp.data ?? null) as MetricsRow | null;
    const snapshotRow = (snapshotResp.data ?? null) as SnapshotRow | null;
    const scorePayload = asObject(latestScore?.score_payload);
    const snapshotPayload = asObject(snapshotRow?.payload);
    const latestSnapshotSummary = asObject(snapshotPayload['source_window']);
    const freshness = freshnessFromComputedAt(latestScore?.computed_at ?? metricsRow?.computed_at ?? null);

    return {
        tenant_id: store.tenant_id,
        store_id: store.store_id,
        seller_uuid: store.seller_uuid,
        provider_key: store.provider_key,
        store_status: store.status,
        active_run_id: activeRunId,
        latest_health_score: latestScore?.score ?? null,
        severity_band: bandFromScore(latestScore?.score ?? null),
        computed_at: latestScore?.computed_at ?? metricsRow?.computed_at ?? null,
        active_clinical_signals: signalRows.map((row) => ({
            signal_key: row.signal_key,
            severity: row.severity,
            evidence: asObject(row.evidence),
            created_at: row.created_at,
        })),
        summarized_metrics: asObject(metricsRow?.metrics),
        minimal_evidence: {
            score_payload: scorePayload,
            top_signal_keys: signalRows.slice(0, 5).map((row) => row.signal_key),
            latest_snapshot_summary: latestSnapshotSummary,
        },
        freshness: {
            status: freshness.status,
            age_seconds: freshness.age_seconds,
            metric_date: activeMetricDate,
            run_status: activeRunRow?.status ?? null,
        },
    };
}
