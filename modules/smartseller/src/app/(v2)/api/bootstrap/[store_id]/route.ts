import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@v2/lib/supabase';

type BootstrapStatus = 'pending' | 'running' | 'completed' | 'failed' | null;

async function getSessionUserId(): Promise<string | null> {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: () => { },
            },
        }
    );
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
}

async function hasMembership(userId: string, storeId: string): Promise<boolean> {
    const { data } = await supabaseAdmin
        .from('v2_store_memberships')
        .select('store_id')
        .eq('user_id', userId)
        .eq('store_id', storeId)
        .limit(1)
        .maybeSingle();
    return Boolean(data);
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ store_id: string }> }
) {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { store_id } = await params;
    if (!store_id) return NextResponse.json({ error: 'Missing store_id' }, { status: 400 });

    const allowed = await hasMembership(userId, store_id);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await supabaseAdmin
        .from('v2_oauth_installations')
        .select('installation_id, bootstrap_status, bootstrap_requested_at, bootstrap_started_at, bootstrap_completed_at, bootstrap_error')
        .eq('linked_store_id', store_id)
        .order('linked_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle<{
            installation_id: string;
            bootstrap_status: BootstrapStatus;
            bootstrap_requested_at: string | null;
            bootstrap_started_at: string | null;
            bootstrap_completed_at: string | null;
            bootstrap_error: string | null;
        }>();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        store_id,
        bootstrap_status: data?.bootstrap_status ?? null,
        bootstrap_requested_at: data?.bootstrap_requested_at ?? null,
        bootstrap_started_at: data?.bootstrap_started_at ?? null,
        bootstrap_completed_at: data?.bootstrap_completed_at ?? null,
        bootstrap_error: data?.bootstrap_error ?? null,
    });
}
