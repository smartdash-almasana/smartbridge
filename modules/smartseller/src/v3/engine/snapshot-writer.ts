import { supabaseAdmin } from '@v2/lib/supabase';

export interface EnsureV3SnapshotInput {
    tenant_id: string;
    store_id: string;
    run_id: string;
    payload?: Record<string, unknown>;
}

export interface EnsureV3SnapshotResult {
    snapshot_id: string;
    created: boolean;
}

function asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

export async function ensureV3Snapshot(input: EnsureV3SnapshotInput): Promise<EnsureV3SnapshotResult> {
    const { tenant_id, store_id, run_id } = input;
    const payloadPatch = input.payload ?? {};

    const { data: existing, error: existingErr } = await supabaseAdmin
        .from('v3_snapshots')
        .select('snapshot_id, payload')
        .eq('tenant_id', tenant_id)
        .eq('store_id', store_id)
        .eq('run_id', run_id)
        .limit(1)
        .maybeSingle<{ snapshot_id: string; payload: Record<string, unknown> | null }>();
    if (existingErr) throw new Error(`[v3-snapshot-writer] snapshot lookup failed: ${existingErr.message}`);

    if (existing?.snapshot_id) {
        const mergedPayload = { ...asObject(existing.payload), ...payloadPatch };
        const { error: updateErr } = await supabaseAdmin
            .from('v3_snapshots')
            .update({ payload: mergedPayload })
            .eq('snapshot_id', existing.snapshot_id)
            .eq('tenant_id', tenant_id)
            .eq('store_id', store_id);
        if (updateErr) throw new Error(`[v3-snapshot-writer] snapshot update failed: ${updateErr.message}`);
        return { snapshot_id: existing.snapshot_id, created: false };
    }

    const { data: created, error: createErr } = await supabaseAdmin
        .from('v3_snapshots')
        .insert({
            tenant_id,
            store_id,
            run_id,
            snapshot_at: new Date().toISOString(),
            payload: payloadPatch,
        })
        .select('snapshot_id')
        .single<{ snapshot_id: string }>();

    if (createErr || !created?.snapshot_id) {
        throw new Error(`[v3-snapshot-writer] snapshot create failed: ${createErr?.message ?? 'unknown error'}`);
    }

    return { snapshot_id: created.snapshot_id, created: true };
}
