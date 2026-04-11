import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: Request) {
    try {
        const internalKey = req.headers.get('x-internal-key');
        if (!internalKey || internalKey !== process.env.INTERNAL_DIAGNOSTICS_KEY) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body;
        try { body = await req.json(); } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { seller_uuid, external_id, sample_pack_id } = body;
        if (!seller_uuid || !external_id) {
            return NextResponse.json({ error: 'Missing seller_uuid or external_id' }, { status: 400 });
        }

        const { data: tokenData, error: tokenError } = await supabaseAdmin
            .from('meli_oauth_tokens')
            .select('access_token')
            .eq('user_id', external_id)
            .single();

        if (tokenError || !tokenData?.access_token) {
            return NextResponse.json({ error: 'missing_token', message: 'No active ML token' }, { status: 422 });
        }
        const accessToken = tokenData.access_token;

        const fetchML = async (path: string) => {
            const url = `https://api.mercadolibre.com${path}`;
            try {
                const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}` } });
                let data = null;
                try {
                    const text = await res.text();
                    if (text) data = JSON.parse(text);
                } catch (e) { }

                let outcome = 'OTHER';
                if (res.status >= 200 && res.status < 300) outcome = 'OK';
                else if (res.status === 401 || res.status === 403) outcome = 'FORBIDDEN';
                else if (res.status === 404) outcome = 'NOT_FOUND';
                else if (res.status === 429) outcome = 'RATE_LIMIT';

                return { path, status: res.status, outcome, message: data?.message || data?.error || 'Unknown' };
            } catch (error: any) {
                return { path, status: 500, outcome: 'OTHER', message: error.message };
            }
        };

        const discovery = {
            claims: {
                candidates: ['/post-purchase/v1/claims/search?status=opened&limit=1'],
                selected: null as any
            },
            messages: {
                candidates: sample_pack_id ? [`/messages/packs/${sample_pack_id}/sellers/${external_id}?tag=post_sale`] : [],
                selected: null as any
            }
        };

        // Test Claims
        for (const candidate of discovery.claims.candidates) {
            const res = await fetchML(candidate);
            if (res.status !== 404) {
                discovery.claims.selected = res;
                break;
            }
        }
        if (!discovery.claims.selected) {
            const fallback = await fetchML(discovery.claims.candidates[0]);
            discovery.claims.selected = fallback;
        }

        // Test Messages
        for (const candidate of discovery.messages.candidates) {
            const res = await fetchML(candidate);
            if (res.status !== 404) {
                discovery.messages.selected = res;
                break;
            }
        }
        if (discovery.messages.candidates.length > 0 && !discovery.messages.selected) {
            const fallback = await fetchML(discovery.messages.candidates[0]);
            discovery.messages.selected = fallback;
        }

        return NextResponse.json({
            ok: true,
            ts: new Date().toISOString(),
            seller_uuid,
            external_id,
            discovery: {
                claims: discovery.claims.selected,
                messages: discovery.messages.selected || { outcome: 'N/A', message: 'No sample order provided' }
            },
            evidence: {
                claims_candidates: discovery.claims.candidates,
                messages_candidates: discovery.messages.candidates,
                claims_runtime_result: discovery.claims.selected,
                messages_runtime_result: discovery.messages.selected
            }
        });

    } catch (error: any) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
