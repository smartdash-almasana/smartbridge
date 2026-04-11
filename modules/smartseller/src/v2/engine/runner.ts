// ============================================================================
// SmartSeller V2 — Engine Runner
// Responsibility: invoke the v2_run_engine_for_store RPC and return result.
// All engine logic lives in the SQL function. No writes from TS. No imports
// from ingest/. No clinical logic here.
// ============================================================================

import { supabaseAdmin } from '../lib/supabase';

export interface EngineRunResult {
    run_id: string;
    score: number;
    signals: number;
}

export async function runEngineForStoreWithDeps(
    storeId: string,
    rpc: (fn: string, params: { p_store_id: string }) => Promise<{ data: unknown; error: unknown }>
): Promise<EngineRunResult> {
    const { data, error } = await rpc('v2_run_engine_for_store', { p_store_id: storeId });

    if (error) throw error;

    return data as EngineRunResult;
}

export async function runEngineForStore(storeId: string): Promise<EngineRunResult> {
    return runEngineForStoreWithDeps(storeId, async (fn, params) => {
        const { data, error } = await supabaseAdmin
            .rpc(fn, params)
            .throwOnError();
        return { data, error };
    });
}
