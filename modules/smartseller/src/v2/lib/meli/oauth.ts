import { supabaseAdmin } from '@v2/lib/supabase';
import { getValidToken } from '@v2/lib/meli-token';

const MELI_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const MELI_ME_URL = 'https://api.mercadolibre.com/users/me';

export interface ExchangedTokens {
    access_token: string;
    refresh_token: string;
    expires_at: string; // ISO string
    raw: unknown;
}

export interface MeliUser {
    id: string;
    nickname: string | null;
}

interface ConsumeOAuthStateRow {
    code_verifier: string;
    user_id: string | null;
}

/**
 * Fetches the first defined env var from a list of candidate names.
 * We support both legacy MERCADOLIBRE_* and current MELI_* names.
 */
function getRequiredEnvAny(names: string[]): string {
    for (const name of names) {
        const value = process.env[name];
        if (value && value.trim().length > 0) return value;
    }
    throw new Error(`[meli/oauth] Missing env: ${names.join(' | ')}`);
}

function computeExpiresAt(expires_in: unknown): string {
    const n = typeof expires_in === 'number' ? expires_in : Number(expires_in);
    if (!Number.isFinite(n) || n <= 0) return '';
    return new Date(Date.now() + n * 1000).toISOString();
}

/**
 * Atomically consumes an OAuth state (single-use, via DELETE...RETURNING).
 * Uses service-role (supabaseAdmin) — bypasses RLS.
 *
 * IMPORTANT:
 * - If the state is invalid/expired/used, we THROW. The caller (callback route)
 *   should catch and render diagnostics (never silently continue).
 */
export async function consumeOAuthState(
    state: string
): Promise<{ codeVerifier: string; userId: string | null }> {
    const { data, error } = await supabaseAdmin
        .rpc('consume_oauth_state', { p_state: state })
        .returns<ConsumeOAuthStateRow[]>();

    if (error) {
        console.error('[meli/oauth] consume_oauth_state RPC error:', error.message);
        throw new Error(`[meli/oauth] State consume failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : undefined;
    if (!row) {
        console.warn(
            '[meli/oauth] consumeOAuthState: no row returned — state invalid, expired, or already used'
        );
        throw new Error('[meli/oauth] Invalid state or session expired (db)');
    }

    return {
        codeVerifier: row.code_verifier,
        userId: row.user_id || null,
    };
}

/**
 * Generates authorization URL (base).
 * NOTE: In SmartSeller V2, /start usually builds the full URL including state and optional PKCE.
 */
export function generateAuthorizationUrl(clientId: string, redirectUri: string): string {
    return `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${encodeURIComponent(
        clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

/**
 * Exchanges an authorization code for tokens.
 *
 * PKCE:
 * - If you are using PKCE, you MUST send code_verifier in the token exchange.
 * - Mercado Libre will NOT return code_verifier in the response; do not “validate” it client-side.
 * - If PKCE is not required/used, pass codeVerifier='' (or undefined) and it will be omitted.
 */
export async function exchangeCodeForTokens(
    code: string,
    codeVerifier?: string
): Promise<ExchangedTokens> {
    // Prefer current env names in Vercel (MELI_*), fallback to legacy MERCADOLIBRE_*
    const clientId = getRequiredEnvAny(['MELI_CLIENT_ID', 'MELI_APP_ID', 'MERCADOLIBRE_CLIENT_ID']);
    const clientSecret = getRequiredEnvAny(['MELI_CLIENT_SECRET', 'MERCADOLIBRE_CLIENT_SECRET']);
    const redirectUri = getRequiredEnvAny(['MELI_REDIRECT_URI', 'MERCADOLIBRE_REDIRECT_URI']);

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
    });

    const usePkce = process.env.MELI_USE_PKCE?.toLowerCase() !== 'false';

    // ✅ PKCE optional (only attach if present and enabled)
    if (usePkce && codeVerifier && codeVerifier.trim().length > 0) {
        body.set('code_verifier', codeVerifier);
    }

    const response = await fetch(MELI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`[meli/oauth] Failed to exchange code: ${text}`);
    }

    const data = JSON.parse(text) as any;

    return {
        access_token: String(data.access_token ?? ''),
        refresh_token: String(data.refresh_token ?? ''),
        expires_at: computeExpiresAt(data.expires_in),
        raw: data,
    };
}

/**
 * Refreshes tokens using refresh_token.
 * NOTE: refresh_token may rotate; always persist the NEW refresh_token returned.
 */
export async function refreshTokens(refreshToken: string): Promise<ExchangedTokens> {
    const clientId = getRequiredEnvAny(['MELI_CLIENT_ID', 'MELI_APP_ID', 'MERCADOLIBRE_CLIENT_ID']);
    const clientSecret = getRequiredEnvAny(['MELI_CLIENT_SECRET', 'MERCADOLIBRE_CLIENT_SECRET']);

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
    });

    const response = await fetch(MELI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`[meli/oauth] Failed to refresh token: ${text}`);
    }

    const data = JSON.parse(text) as any;

    return {
        access_token: String(data.access_token ?? ''),
        refresh_token: String(data.refresh_token ?? ''),
        expires_at: computeExpiresAt(data.expires_in),
        raw: data,
    };
}

/**
 * Fetches user information from Mercado Libre.
 */
export async function getMeliUser(storeId: string): Promise<MeliUser> {
    const accessToken = await getValidToken(storeId);
    return getMeliUserFromAccessToken(accessToken);
}

export async function getMeliUserFromAccessToken(accessToken: string): Promise<MeliUser> {
    const response = await fetch(MELI_ME_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`[meli/oauth] Failed to fetch user: ${text}`);
    }

    const data = JSON.parse(text) as any;
    return {
        id: String(data.id ?? ''),
        nickname: data.nickname ? String(data.nickname) : null,
    };
}
