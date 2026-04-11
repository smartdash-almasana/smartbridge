import { supabaseAdmin } from '@v2/lib/supabase';

export interface EnsureV3EngineRunInput {
    tenant_id: string;
    store_id: string;
    metric_date?: string;
    orchestrator_key?: string;
}

export interface EnsureV3EngineRunResult {
    run_id: string;
    metric_date: string;
    created: boolean;
}

export async function ensureV3EngineRun(input: EnsureV3EngineRunInput): Promise<EnsureV3EngineRunResult> {
    const tenant_id = input.tenant_id;
    const store_id = input.store_id;
    const metric_date = input.metric_date ?? new Date().toISOString().slice(0, 10);
    const orchestrator_key = input.orchestrator_key ?? 'v3_clinical_orchestrator_skeleton';

    const { data: existing, error: existingErr } = await supabaseAdmin
        .from('v3_engine_runs')
        .select('run_id')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('metric_date', metric_date)
        .eq('orchestrator_key', orchestrator_key)
        .limit(1)
        .maybeSingle<{ run_id: string }>();

    if (existingErr) throw new Error(`[v3-run-writer] existing run lookup failed: ${existingErr.message}`);
    if (existing?.run_id) {
        return { run_id: existing.run_id, metric_date, created: false };
    }

    const { data: created, error: createErr } = await supabaseAdmin
        .from('v3_engine_runs')
        .insert({
            tenant_id,
            store_id,
            metric_date,
            orchestrator_key,
            status: 'running',
            started_at: new Date().toISOString(),
        })
        .select('run_id')
        .single<{ run_id: string }>();

    if (createErr || !created?.run_id) {
        if (createErr?.code !== '23505') {
            throw new Error(`[v3-run-writer] run create failed: ${createErr?.message ?? 'unknown error'}`);
        }
        const { data: conflictRow, error: conflictErr } = await supabaseAdmin
            .from('v3_engine_runs')
            .select('run_id')
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id)
            .eq('metric_date', metric_date)
            .eq('orchestrator_key', orchestrator_key)
            .limit(1)
            .maybeSingle<{ run_id: string }>();
        if (conflictErr || !conflictRow?.run_id) {
            throw new Error(`[v3-run-writer] run conflict lookup failed: ${conflictErr?.message ?? 'missing row after conflict'}`);
        }
        return { run_id: conflictRow.run_id, metric_date, created: false };
    }

    return { run_id: created.run_id, metric_date, created: true };
}
