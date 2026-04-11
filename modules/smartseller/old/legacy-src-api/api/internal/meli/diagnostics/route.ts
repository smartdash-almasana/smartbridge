import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: Request) {
    try {
        // 1. Authorization
        const internalKey = req.headers.get('x-internal-key');
        if (!internalKey || internalKey !== process.env.INTERNAL_DIAGNOSTICS_KEY) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 2. Parse payload
        let body;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { seller_uuid, external_id, sample_pack_id } = body;

        if (!seller_uuid || !external_id) {
            return NextResponse.json({ error: 'Missing seller_uuid or external_id' }, { status: 400 });
        }

        // 3. Resolve ML Credentials
        // Intenta buscar el token en meli_oauth_tokens primero, o la tabla que corresponda en el entorno
        const { data: tokenData, error: tokenError } = await supabaseAdmin
            .from('meli_oauth_tokens')
            .select('access_token')
            .eq('user_id', external_id)
            .single();

        if (tokenError || !tokenData?.access_token) {
            return NextResponse.json({ error: 'missing_token', message: 'No active ML token found for seller' }, { status: 422 });
        }

        const accessToken = tokenData.access_token;

        // Helper to fetch ML
        const fetchML = async (path: string, moduleName: string) => {
            const url = `https://api.mercadolibre.com${path}`;
            try {
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                });

                let data = null;
                try {
                    const text = await res.text();
                    if (text) data = JSON.parse(text);
                } catch (e) { }

                let outcome = 'OTHER';
                let availability = 'NOT_AVAILABLE';

                if (res.status >= 200 && res.status < 300) {
                    outcome = 'OK';
                    availability = 'MEASURED';
                }
                else if (res.status === 401 || res.status === 403) {
                    outcome = 'FORBIDDEN';
                    availability = 'NOT_AVAILABLE';
                }
                else if (res.status === 404) {
                    outcome = 'NOT_FOUND';
                    availability = 'NOT_AVAILABLE';
                }
                else if (res.status === 429) {
                    outcome = 'RATE_LIMIT';
                    availability = 'NOT_AVAILABLE';
                }

                // Log solo la info segura
                console.log(`[ML_DIAGNOSTICS] Module=${moduleName} Endpoint=${path} Status=${res.status} Outcome=${outcome} Auth=${availability}`);

                return {
                    module: moduleName,
                    endpoint: path,
                    status: res.status,
                    outcome,
                    availability,
                    note: res.status === 200 ? 'OK' : (data?.message || data?.error || 'Error'),
                    data // Retornamos para extraer samples
                };
            } catch (error: any) {
                console.error(`[ML_DIAGNOSTICS] Module=${moduleName} Error:`, error.message);
                return {
                    module: moduleName,
                    endpoint: path,
                    status: 500,
                    outcome: 'OTHER',
                    availability: 'NOT_AVAILABLE',
                    note: error.message || 'Fetch failed'
                };
            }
        };

        const results = [];
        const samples = {
            pack_id: sample_pack_id || null, // Prefer user provided
            shipment_id: null as string | null,
            item_id: null as string | null,
        };

        // A) Users
        const rUsers = await fetchML('/users/me', 'users');
        results.push({ ...rUsers, data: undefined });

        // B) Orders
        const rOrders = await fetchML(`/orders/search?seller=${external_id}&limit=1&offset=0`, 'orders');
        if (rOrders.status === 200 && (!rOrders.data?.results || rOrders.data.results.length === 0)) {
            rOrders.availability = 'ZERO_REAL';
        }
        results.push({ ...rOrders, data: undefined });

        if (rOrders.status === 200 && rOrders.data?.results?.length > 0) {
            const o = rOrders.data.results[0];
            if (!samples.pack_id && o.pack_id) samples.pack_id = String(o.pack_id); // Source canonico desde orders payload
            if (o.shipping?.id) samples.shipment_id = o.shipping.id;
            if (o.order_items?.length > 0) samples.item_id = o.order_items[0].item.id;
        }

        // C) Shipments
        if (samples.shipment_id) {
            const rShipments = await fetchML(`/shipments/${samples.shipment_id}`, 'shipments');
            results.push({ ...rShipments, data: undefined });
        } else {
            results.push({ module: 'shipments', endpoint: '/shipments/{id}', status: null, outcome: 'N/A', availability: 'NOT_AVAILABLE', note: 'No shipment_id in sample' });
        }

        // D) Questions
        const rQuestions = await fetchML(`/questions/search?seller_id=${external_id}&limit=1&offset=0`, 'questions');
        if (rQuestions.status === 200 && (!rQuestions.data?.questions || rQuestions.data.questions.length === 0)) {
            rQuestions.availability = 'ZERO_REAL';
        }
        results.push({ ...rQuestions, data: undefined });

        // E) Items
        if (samples.item_id) {
            const rItems = await fetchML(`/items/${samples.item_id}`, 'items');
            // Si el status es 403, probablemente falten scopes o app permissions
            if (rItems.status === 403) {
                rItems.outcome = 'NOT_AVAILABLE';
                rItems.availability = 'NOT_AVAILABLE';
                rItems.note = "PolicyAgent 403 UNAUTHORIZED";
            }
            results.push({ ...rItems, data: undefined });
        } else {
            results.push({ module: 'items', endpoint: '/items/{id}', status: null, outcome: 'N/A', availability: 'NOT_AVAILABLE', note: 'No item_id in sample' });
        }

        // F) Claims - usando endpoint canónico
        const rClaims = await fetchML(`/post-purchase/v1/claims/search?status=opened&limit=1`, 'claims');
        if (rClaims.status === 404) {
            rClaims.outcome = 'NOT_AVAILABLE';
            rClaims.availability = 'NOT_AVAILABLE';
            rClaims.note = 'Not found - ' + rClaims.note;
            results.push({ ...rClaims, data: undefined });
        } else {
            if (rClaims.status === 200 && (!rClaims.data?.data || rClaims.data.data.length === 0)) {
                rClaims.availability = 'ZERO_REAL';
            }
            results.push({ ...rClaims, data: undefined });
        }

        // G) Messages - usando endpoint canónico (con tag=post_sale)
        if (samples.pack_id) {
            const rMessages = await fetchML(`/messages/packs/${samples.pack_id}/sellers/${external_id}?tag=post_sale`, 'messages');
            if (rMessages.status === 404) {
                rMessages.outcome = 'NOT_AVAILABLE';
                rMessages.availability = 'NOT_AVAILABLE';
                rMessages.note = 'Not found - ' + rMessages.note;
                results.push({ ...rMessages, data: undefined });
            } else if (rMessages.status === 400) {
                rMessages.outcome = 'BAD_REQUEST';
                rMessages.availability = 'NOT_AVAILABLE';
                rMessages.note = 'NO_PACK_CONTEXT: ' + rMessages.note;
                results.push({ ...rMessages, data: undefined });
            } else {
                if (rMessages.status === 200 && (!rMessages.data?.messages || rMessages.data.messages.length === 0)) {
                    rMessages.availability = 'ZERO_REAL';
                }
                results.push({ ...rMessages, data: undefined });
            }
        } else {
            results.push({ module: 'messages', endpoint: '/messages/packs/{id}/sellers/{id}', status: null, outcome: 'N/A', availability: 'NOT_AVAILABLE', note: 'No pack_id sample provided or found' });
        }

        return NextResponse.json({
            ok: true,
            ts: new Date().toISOString(),
            seller_uuid,
            external_id,
            results,
            samples
        });

    } catch (error: any) {
        console.error('[ML_DIAGNOSTICS] Unhandled Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
