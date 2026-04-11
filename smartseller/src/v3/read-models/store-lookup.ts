import { supabaseAdmin } from '@v2/lib/supabase';

interface SellerRow {
    tenant_id: string;
    seller_uuid: string;
    display_name: string | null;
}

interface StoreRow {
    tenant_id: string;
    store_id: string;
    seller_uuid: string;
    store_key: string;
    provider_key: 'mercadolibre' | 'shopify' | 'system';
    status: 'active' | 'inactive';
}

export interface V3StoreLookupItem {
    tenant_id: string;
    store_id: string;
    seller_uuid: string;
    display_name: string;
    store_name: string;
    store_key: string;
    provider_key: 'mercadolibre' | 'shopify' | 'system';
    store_status: 'active' | 'inactive';
}

export async function findV3StoresByHumanName(query: string, limit = 10): Promise<V3StoreLookupItem[]> {
    const term = query.trim();
    if (!term) return [];

    const cappedLimit = Math.max(1, Math.min(limit, 8));
    const like = `%${term}%`;

    const { data: sellerMatches, error: sellerErr } = await supabaseAdmin
        .from('v3_sellers')
        .select('tenant_id,seller_uuid,display_name')
        .ilike('display_name', like)
        .limit(cappedLimit * 2)
        .returns<SellerRow[]>();
    if (sellerErr) throw new Error(`[v3-store-lookup] seller lookup failed: ${sellerErr.message}`);

    const sellerUuidMatches = Array.from(new Set((sellerMatches ?? []).map((s) => s.seller_uuid)));
    const storesFromSellerQuery = sellerUuidMatches.length
        ? await supabaseAdmin
            .from('v3_stores')
            .select('tenant_id,store_id,seller_uuid,store_key,provider_key,status')
            .in('seller_uuid', sellerUuidMatches)
            .limit(cappedLimit * 3)
            .returns<StoreRow[]>()
        : { data: [] as StoreRow[], error: null };
    if (storesFromSellerQuery.error) {
        throw new Error(`[v3-store-lookup] stores by seller failed: ${storesFromSellerQuery.error.message}`);
    }

    const { data: storeKeyMatches, error: storeKeyErr } = await supabaseAdmin
        .from('v3_stores')
        .select('tenant_id,store_id,seller_uuid,store_key,provider_key,status')
        .ilike('store_key', like)
        .limit(cappedLimit * 2)
        .returns<StoreRow[]>();
    if (storeKeyErr) throw new Error(`[v3-store-lookup] stores by key failed: ${storeKeyErr.message}`);

    const mergedStores = [...(storesFromSellerQuery.data ?? []), ...(storeKeyMatches ?? [])];
    if (mergedStores.length === 0) return [];

    const sellerNameByUuid = new Map<string, string>();
    for (const seller of sellerMatches ?? []) {
        const label = (seller.display_name ?? '').trim();
        if (label && !sellerNameByUuid.has(seller.seller_uuid)) {
            sellerNameByUuid.set(seller.seller_uuid, label);
        }
    }

    const missingSellerUuids = Array.from(
        new Set(
            mergedStores
                .map((store) => store.seller_uuid)
                .filter((sellerUuid) => !sellerNameByUuid.has(sellerUuid))
        )
    );

    if (missingSellerUuids.length > 0) {
        const { data: sellersByUuid, error: sellerByUuidErr } = await supabaseAdmin
            .from('v3_sellers')
            .select('tenant_id,seller_uuid,display_name')
            .in('seller_uuid', missingSellerUuids)
            .returns<SellerRow[]>();
        if (sellerByUuidErr) throw new Error(`[v3-store-lookup] sellers by uuid failed: ${sellerByUuidErr.message}`);

        for (const seller of sellersByUuid ?? []) {
            const label = (seller.display_name ?? '').trim();
            if (label && !sellerNameByUuid.has(seller.seller_uuid)) {
                sellerNameByUuid.set(seller.seller_uuid, label);
            }
        }
    }

    const results = new Map<string, V3StoreLookupItem>();
    for (const store of mergedStores) {
        const key = `${store.tenant_id}:${store.store_id}`;
        if (results.has(key)) continue;

        const sellerName = sellerNameByUuid.get(store.seller_uuid);
        const displayName = sellerName && sellerName.length > 0 ? sellerName : store.store_key;
        results.set(key, {
            tenant_id: store.tenant_id,
            store_id: store.store_id,
            seller_uuid: store.seller_uuid,
            display_name: displayName,
            store_name: displayName,
            store_key: store.store_key,
            provider_key: store.provider_key,
            store_status: store.status,
        });
    }

    const normalizedTerm = term.toLowerCase();
    const rank = (item: V3StoreLookupItem): number => {
        const name = item.display_name.toLowerCase();
        const key = item.store_key.toLowerCase();

        if (name === normalizedTerm) return 100;
        if (key === normalizedTerm) return 95;
        if (name.startsWith(normalizedTerm)) return 90;
        if (key.startsWith(normalizedTerm)) return 85;
        if (name.includes(normalizedTerm)) return 70;
        if (key.includes(normalizedTerm)) return 60;
        return 10;
    };

    return Array.from(results.values())
        .sort((a, b) => {
            const scoreDelta = rank(b) - rank(a);
            if (scoreDelta !== 0) return scoreDelta;
            if (a.store_status !== b.store_status) return a.store_status === 'active' ? -1 : 1;
            return a.display_name.localeCompare(b.display_name);
        })
        .slice(0, cappedLimit);
}
