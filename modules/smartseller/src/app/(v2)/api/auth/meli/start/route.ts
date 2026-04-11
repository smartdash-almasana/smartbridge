// ============================================================================
// SmartSeller V2 — /api/auth/meli/start
// GET: initiates PKCE OAuth flow for MercadoLibre
//
// 1. Generate cryptographically random state + code_verifier
// 2. Derive code_challenge (S256)
// 3. Persist to v2_oauth_states (TTL = 15 min, via service-role)
// 4. Redirect to ML authorization URL
//
// Env vars required: MELI_APP_ID, MELI_REDIRECT_URI
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@v2/lib/supabase';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const OAUTH_CTX_MAX_AGE_SECONDS = 15 * 60;

// ─── PKCE helpers ─────────────────────────────────────────────────────────────
function generateRandomBase64url(byteLength: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    return Buffer.from(bytes).toString('base64url');
}

async function deriveCodeChallenge(verifier: string): Promise<string> {
    const encoded = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Buffer.from(digest).toString('base64url');
}

function sanitizeNext(raw: string | null): string | null {
    if (!raw) return null;
    if (!raw.startsWith('/')) return null;
    if (raw.startsWith('//')) return null;
    return raw;
}

// ─── Route handler ────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
    const appId = process.env.MELI_CLIENT_ID || process.env.MELI_APP_ID;
    const redirectUri = process.env.MELI_REDIRECT_URI;

    if (!appId || !redirectUri) {
        return NextResponse.json(
            { error: 'Missing env: MELI_CLIENT_ID/MELI_APP_ID or MELI_REDIRECT_URI' },
            { status: 500 }
        );
    }

    // Optionally bind state to authenticated Supabase user (best-effort)
    const cookieStore = await cookies();
    const supabaseUser = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: () => { },  // read-only here
            },
        }
    );
    const { data: { session } } = await supabaseUser.auth.getSession();
    const userId = session?.user?.id ?? null;

    // Generate PKCE pair
    const usePkce = process.env.MELI_USE_PKCE?.toLowerCase() !== 'false';
    const state = generateRandomBase64url(32);           // 256-bit state
    const codeVerifier = usePkce ? generateRandomBase64url(48) : '';     // 384-bit verifier
    const codeChallenge = usePkce ? await deriveCodeChallenge(codeVerifier) : '';
    const correlationId = state;
    const nextPath = sanitizeNext(req.nextUrl.searchParams.get('next'));

    // TTL = 15 min (must cover the full ML authorization UX round-trip)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Persist PKCE state via service-role (bypasses RLS, guarantees write)
    const { error: insertErr } = await supabaseAdmin
        .from('v2_oauth_states')
        .insert({
            state,
            code_verifier: codeVerifier,
            user_id: userId,
            expires_at: expiresAt,
        });

    if (insertErr) {
        console.error('[auth/meli/start] Failed to persist state:', insertErr.message);
        return NextResponse.json({ error: 'Failed to initiate OAuth' }, { status: 500 });
    }

    console.log('[auth/meli/start]', correlationId, 'state persisted; user_id =', userId ?? 'null', 'expires_at =', expiresAt);

    // Build ML authorization URL
    const authUrl = new URL('https://auth.mercadolibre.com.ar/authorization');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    if (usePkce) {
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
    }

    console.log('[auth/meli/start]', correlationId, 'redirecting to ML authorization');
    const response = NextResponse.redirect(authUrl.toString());
    response.cookies.set('meli_oauth_state', state, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: OAUTH_CTX_MAX_AGE_SECONDS,
    });
    if (usePkce) {
        response.cookies.set('meli_oauth_verifier', codeVerifier, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: OAUTH_CTX_MAX_AGE_SECONDS,
        });
    }
    if (nextPath) {
        response.cookies.set('meli_oauth_next', nextPath, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: OAUTH_CTX_MAX_AGE_SECONDS,
        });
    } else {
        response.cookies.set('meli_oauth_next', '', {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 0,
        });
    }

    return response;
}
