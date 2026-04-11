/**
 * V3 ML Identity Resolver
 * ADR-0010: resolves canonical (tenant_id, store_id) for v3_stores
 * given a Mercado Libre external_account_id.
 *
 * Strategy (ordered):
 *   1. Look up v3_stores by store_key = external_account_id AND provider_key = 'mercadolibre'
 *   2. If not found, resolve explicit mapping from v3_store_v2_bridge
 *   3. If neither found → throw (identity unresolvable, block ingestion)
 *
 * The adapter MUST NOT call this with a null/empty external_account_id.
 * Resolution failure is not silently swallowed; callers must handle it.
 */

import { supabaseAdmin } from '@v2/lib/supabase';

export interface V3ResolvedIdentity {
    tenant_id: string;
    store_id: string;
    /** 'v3' if found in v3_stores, 'v2_bridge' if resolved from v2_stores */
    source: 'v3' | 'v2_bridge';
}

interface V3StoreRow {
    tenant_id: string;
    store_id: string;
}

interface V3BridgeRow {
    tenant_id: string;
    store_id: string;
}

/**
 * Resolve tenant_id and store_id for a given Mercado Libre external_account_id.
 * Throws if identity cannot be resolved.
 */
export async function resolveV3MeliIdentity(
    externalAccountId: string
): Promise<V3ResolvedIdentity> {
    if (!externalAccountId || !externalAccountId.trim()) {
        throw new Error('[v3/ml-identity] externalAccountId is required');
    }

    // --- Step 1: lookup in v3_stores ---
    const { data: v3Row, error: v3Err } = await supabaseAdmin
        .from('v3_stores')
        .select('tenant_id, store_id')
        .eq('provider_key', 'mercadolibre')
        .eq('store_key', externalAccountId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle<V3StoreRow>();

    if (v3Err) {
        throw new Error(
            `[v3/ml-identity] v3_stores lookup failed: ${v3Err.message}`
        );
    }

    if (v3Row) {
        return {
            tenant_id: v3Row.tenant_id,
            store_id: v3Row.store_id,
            source: 'v3',
        };
    }

    // --- Step 2: explicit bridge mapping (temporary V2 dependency) ---
    const { data: bridgeRow, error: bridgeErr } = await supabaseAdmin
        .from('v3_store_v2_bridge')
        .select('tenant_id, store_id')
        .eq('provider_key', 'mercadolibre')
        .eq('is_active', true)
        .eq('external_account_id', externalAccountId)
        .limit(1)
        .maybeSingle<V3BridgeRow>();

    if (bridgeErr) {
        throw new Error(
            `[v3/ml-identity] v3_store_v2_bridge lookup failed: ${bridgeErr.message}`
        );
    }

    if (bridgeRow) {
        return {
            tenant_id: bridgeRow.tenant_id,
            store_id: bridgeRow.store_id,
            source: 'v2_bridge',
        };
    }

    // --- Identity unresolvable ---
    throw new Error(
        `[v3/ml-identity] No store found for ML account ${externalAccountId} in v3_stores or v3_store_v2_bridge. ` +
        'Webhook dropped. Bridge mapping required while OAuth remains in V2.'
    );
}
