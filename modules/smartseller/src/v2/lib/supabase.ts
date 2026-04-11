// ============================================================================
// SmartSeller V2 — Supabase Admin Client (lazy singleton)
// Uses SUPABASE_SERVICE_ROLE_KEY — bypasses RLS.
// Lazy init: validation runs on first call, not at module load.
// This avoids build-time failures when env vars are only available at runtime.
// ============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
    if (_client) return _client;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
        throw new Error('[supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL');
    }
    if (!serviceRoleKey) {
        throw new Error('[supabase] Missing env: SUPABASE_SERVICE_ROLE_KEY');
    }

    _client = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    return _client;
}

// Proxy: behaves like a SupabaseClient at call sites but initializes lazily.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
        return (getClient() as unknown as Record<string | symbol, unknown>)[prop];
    },
});
