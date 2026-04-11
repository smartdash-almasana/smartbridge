import { readV3ClinicalStatus, V3ClinicalStatusStoreNotFoundError } from '@/v3/read-models/clinical-status';
import { readV3RunHistory, V3RunHistoryStoreNotFoundError } from '@/v3/read-models/run-history';

type PulseSeverity = 'info' | 'warning' | 'critical';
type HealthBand = 'healthy' | 'warning' | 'critical' | null;
type FreshnessStatus = 'fresh' | 'stale' | 'outdated' | 'empty';
type EngineRunStatus = 'running' | 'done' | 'failed';

export { V3RunHistoryStoreNotFoundError, V3ClinicalStatusStoreNotFoundError };

export interface V3StorePulseResponse {
    tenant_id: string;
    store_id: string;
    provider_key: string;
    store_status: string;
    current: {
        run_id: string | null;
        metric_date: string | null;
        score: number | null;
        severity_band: HealthBand;
        computed_at: string | null;
        freshness_status: FreshnessStatus;
        age_seconds: number | null;
        active_signals: Array<{
            signal_key: string;
            severity: PulseSeverity;
        }>;
    };
    recent_runs: Array<{
        run_id: string;
        metric_date: string;
        status: EngineRunStatus;
        score: number | null;
        signal_count: number;
        top_severity: PulseSeverity | null;
    }>;
}

export async function readV3StorePulse(args: {
    tenant_id: string;
    store_id: string;
}): Promise<V3StorePulseResponse> {
    const { tenant_id, store_id } = args;

    const runHistory = await readV3RunHistory({ tenant_id, store_id, limit: 5 });
    const clinicalStatus = await readV3ClinicalStatus({ tenant_id, store_id });

    return {
        tenant_id: clinicalStatus.tenant_id,
        store_id: clinicalStatus.store_id,
        provider_key: clinicalStatus.provider_key,
        store_status: clinicalStatus.store_status,
        current: {
            run_id: clinicalStatus.active_run_id,
            metric_date: clinicalStatus.freshness.metric_date,
            score: clinicalStatus.latest_health_score,
            severity_band: clinicalStatus.severity_band,
            computed_at: clinicalStatus.computed_at,
            freshness_status: clinicalStatus.freshness.status,
            age_seconds: clinicalStatus.freshness.age_seconds,
            active_signals: clinicalStatus.active_clinical_signals.map((signal) => ({
                signal_key: signal.signal_key,
                severity: signal.severity as PulseSeverity,
            })),
        },
        recent_runs: runHistory.runs.map((run) => ({
            run_id: run.run_id,
            metric_date: run.metric_date,
            status: run.status,
            score: run.score,
            signal_count: run.signals.length,
            top_severity: run.signals[0]?.severity ?? null,
        })),
    };
}
