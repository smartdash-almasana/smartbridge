// ============================================================================
// SmartSeller V2 — /api/me
// GET: returns session user + their stores, with deterministic redirect hint
//
// Response shapes:
//   401  → { error: 'Unauthorized' }
//   200 (0 stores)  → { user_id, stores: [], redirect: '/onboarding' }
//   200 (1 store)   → { user_id, stores: [...], redirect: '/dashboard/{store_id}' }
//   200 (N stores)  → { user_id, stores: [...], redirect: '/choose-store' }
//
// Uses anon client (session-scoped) for reading stores so RLS applies.
// Uses admin client for membership lookup (bypasses RLS to ensure write-path integrity).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

interface StoreSlim {
    store_id: string;
    display_name: string | null;
    provider_key: string;
}

interface MeResponse {
    user_id: string;
    stores: StoreSlim[];
    redirect: string;
}

export async function GET(_req: NextRequest): Promise<NextResponse<MeResponse | { error: string }>> {
    const cookieStore = await cookies();

    // Create server-side Supabase client honoring the session cookie
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: () => { },  // read-only
            },
        }
    );

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Query memberships + joined store info via RLS-aware client
    const { data: memberships, error } = await supabase
        .from('v2_store_memberships')
        .select(`
            store_id,
            v2_stores (
                store_id,
                display_name,
                provider_key
            )
        `)
        .eq('user_id', userId);

    if (error) {
        console.error('[api/me] membership query error:', error.message);
        return NextResponse.json({ error: 'Failed to fetch stores' } as { error: string }, { status: 500 });
    }

    const stores: StoreSlim[] = (memberships ?? [])
        .map((m) => {
            const s = m.v2_stores as unknown as StoreSlim | null;
            if (!s) return null;
            return {
                store_id: s.store_id,
                display_name: s.display_name ?? null,
                provider_key: s.provider_key,
            };
        })
        .filter((s): s is StoreSlim => s !== null);

    // Deterministic redirect hint
    let redirect: string;
    if (stores.length === 0) {
        redirect = '/onboarding';
    } else if (stores.length === 1) {
        redirect = `/dashboard/${stores[0].store_id}`;
    } else {
        redirect = '/choose-store';
    }

    return NextResponse.json({ user_id: userId, stores, redirect });
}
