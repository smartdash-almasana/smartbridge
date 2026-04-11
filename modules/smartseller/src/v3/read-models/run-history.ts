import { supabaseAdmin } from '@v2/lib/supabase';

type EngineRunStatus = 'running' | 'done' | 'failed';
type SignalSeverity = 'none' | 'info' | 'warning' | 'critical';

interface StoreRow {
    tenant_id: string;
    store_id: string;
}

interface EngineRunRow {
    run_id: string;
    status: EngineRunStatus;
    started_at: string;
    finished_at: string | null;
    metric_date: string;
}

interface HealthScoreRow {
    run_id: string;
    score: number;
    computed_at: string;
    snapshot_id: string | null;
}

interface SignalRow {
    run_id: string;
    signal_key: string;
    severity: SignalSeverity;
}

interface SnapshotRow {
    run_id: string;
    snapshot_id: string;
}

export class V3RunHistoryStoreNotFoundError extends Error {
    code = 'STORE_NOT_FOUND' as const;

    constructor() {
        super('[v3-run-history] store not found');
        this.name = 'V3RunHistoryStoreNotFoundError';
    }
}

export interface V3RunHistoryResponse {
    tenant_id: string;
    store_id: string;
    limit: number;
    runs: Array<{
        run_id: string;
        status: EngineRunStatus;
        started_at: string;
        finished_at: string | null;
        metric_date: string;
        score: number | null;
        score_computed_at: string | null;
        snapshot_id: string | null;
        signals: Array<{
            signal_key: string;
            severity: Exclude<SignalSeverity, 'none'>;
        }>;
    }>;
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

export async function readV3RunHistory(args: {
    tenant_id: string;
    store_id: string;
    limit: number;
}): Promise<V3RunHistoryResponse> {
    const { tenant_id, store_id, limit } = args;

    const { data: store, error: storeErr } = await supabaseAdmin
        .from('v3_stores')
        .select('tenant_id,store_id')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .limit(1)
        .maybeSingle<StoreRow>();
    if (storeErr) throw new Error(`[v3-run-history] store lookup failed: ${storeErr.message}`);
    if (!store) throw new V3RunHistoryStoreNotFoundError();

    const { data: runRows, error: runErr } = await supabaseAdmin
        .from('v3_engine_runs')
        .select('run_id,status,started_at,finished_at,metric_date')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .order('started_at', { ascending: false })
        .limit(limit)
        .returns<EngineRunRow[]>();
    if (runErr) throw new Error(`[v3-run-history] engine_runs lookup failed: ${runErr.message}`);

    const runs = runRows ?? [];
    const runIds = runs.map((row) => row.run_id);

    if (runIds.length === 0) {
        return {
            tenant_id: store.tenant_id,
            store_id: store.store_id,
            limit,
            runs: [],
        };
    }

    const [scoresResp, signalsResp, snapshotsResp] = await Promise.all([
        supabaseAdmin
            .from('v3_health_scores')
            .select('run_id,score,computed_at,snapshot_id')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .in('run_id', runIds)
            .returns<HealthScoreRow[]>(),
        supabaseAdmin
            .from('v3_clinical_signals')
            .select('run_id,signal_key,severity')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .in('run_id', runIds)
            .returns<SignalRow[]>(),
        supabaseAdmin
            .from('v3_snapshots')
            .select('run_id,snapshot_id')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .in('run_id', runIds)
            .returns<SnapshotRow[]>(),
    ]);

    if (scoresResp.error) throw new Error(`[v3-run-history] health_scores lookup failed: ${scoresResp.error.message}`);
    if (signalsResp.error) throw new Error(`[v3-run-history] clinical_signals lookup failed: ${signalsResp.error.message}`);
    if (snapshotsResp.error) throw new Error(`[v3-run-history] snapshots lookup failed: ${snapshotsResp.error.message}`);

    const scoreByRunId = new Map<string, HealthScoreRow>();
    for (const row of scoresResp.data ?? []) {
        if (!scoreByRunId.has(row.run_id)) {
            scoreByRunId.set(row.run_id, row);
        }
    }

    const snapshotByRunId = new Map<string, string>();
    for (const row of snapshotsResp.data ?? []) {
        if (!snapshotByRunId.has(row.run_id)) {
            snapshotByRunId.set(row.run_id, row.snapshot_id);
        }
    }

    const signalsByRunId = new Map<string, SignalRow[]>();
    for (const row of signalsResp.data ?? []) {
        if (row.severity === 'none') continue;
        const current = signalsByRunId.get(row.run_id) ?? [];
        current.push(row);
        signalsByRunId.set(row.run_id, current);
    }

    return {
        tenant_id: store.tenant_id,
        store_id: store.store_id,
        limit,
        runs: runs.map((run) => {
            const score = scoreByRunId.get(run.run_id) ?? null;
            const snapshotId = score?.snapshot_id ?? snapshotByRunId.get(run.run_id) ?? null;
            const signals = (signalsByRunId.get(run.run_id) ?? [])
                .sort((a, b) => {
                    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
                    if (severityDelta !== 0) return severityDelta;
                    return a.signal_key.localeCompare(b.signal_key);
                })
                .map((row) => ({
                    signal_key: row.signal_key,
                    severity: row.severity as Exclude<SignalSeverity, 'none'>,
                }));

            return {
                run_id: run.run_id,
                status: run.status,
                started_at: run.started_at,
                finished_at: run.finished_at,
                metric_date: run.metric_date,
                score: score?.score ?? null,
                score_computed_at: score?.computed_at ?? null,
                snapshot_id: snapshotId,
                signals,
            };
        }),
    };
}
