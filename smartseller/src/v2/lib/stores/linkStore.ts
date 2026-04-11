import { supabaseAdmin } from '@v2/lib/supabase';

interface StoreRow {
    store_id: string;
    tenant_id: string;
    display_name: string | null;
}

interface MembershipRow {
    tenant_id: string;
}

export interface LinkStoreInput {
    userId: string;
    externalAccountId: string;
    providerKey?: 'mercadolibre' | 'meli';
    displayName?: string | null;
    tenantId?: string | null;
}

export interface LinkStoreResult {
    storeId: string;
    tenantId: string;
}

async function resolveTenantId(userId: string): Promise<string | null> {
    const { data, error } = await supabaseAdmin
        .from('v2_store_memberships')
        .select('tenant_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle<MembershipRow>();

    if (error) throw new Error(`[stores/link] tenant lookup failed: ${error.message}`);
    return data?.tenant_id ?? null;
}

export async function upsertStoreAndMembership(input: LinkStoreInput): Promise<LinkStoreResult> {
    const providerKey = input.providerKey === 'meli' ? 'mercadolibre' : (input.providerKey ?? 'mercadolibre');
    const externalAccountId = String(input.externalAccountId);

    const { data: existing, error: existingErr } = await supabaseAdmin
        .from('v2_stores')
        .select('store_id, tenant_id, display_name')
        .eq('provider_key', providerKey)
        .eq('external_account_id', externalAccountId)
        .limit(1)
        .maybeSingle<StoreRow>();

    if (existingErr) throw new Error(`[stores/link] store lookup failed: ${existingErr.message}`);

    let storeId: string;
    let tenantId: string;

    if (existing) {
        storeId = existing.store_id;
        tenantId = existing.tenant_id;
        const shouldUpdateDisplayName =
            !!input.displayName &&
            (!existing.display_name || existing.display_name.trim().length === 0);
        if (shouldUpdateDisplayName) {
            const { error: updateErr } = await supabaseAdmin
                .from('v2_stores')
                .update({ display_name: input.displayName })
                .eq('store_id', storeId);
            if (updateErr) throw new Error(`[stores/link] store display_name update failed: ${updateErr.message}`);
        }
    } else {
        tenantId = input.tenantId ?? await resolveTenantId(input.userId) ?? '';
        if (!tenantId) {
            throw new Error('[stores/link] No tenant_id available for current user');
        }

        storeId = crypto.randomUUID();
        const { error: insertErr } = await supabaseAdmin
            .from('v2_stores')
            .insert({
                store_id: storeId,
                tenant_id: tenantId,
                seller_uuid: crypto.randomUUID(),
                provider_key: providerKey,
                external_account_id: externalAccountId,
                connection_status: 'connected',
                display_name: input.displayName ?? null,
            });

        if (insertErr) throw new Error(`[stores/link] store insert failed: ${insertErr.message}`);
    }

    const { error: membershipErr } = await supabaseAdmin
        .from('v2_store_memberships')
        .upsert(
            {
                tenant_id: tenantId,
                store_id: storeId,
                user_id: input.userId,
                role: 'owner',
            },
            { onConflict: 'user_id,store_id' }
        );

    if (membershipErr) throw new Error(`[stores/link] membership upsert failed: ${membershipErr.message}`);
    return { storeId, tenantId };
}
