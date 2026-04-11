// ============================================================================
// SmartSeller V2 — /api/auth/meli/callback
// GET: receives code + state from Mercado Libre after user authorization
//
// Flow:
//   1. Consume state atomically (DELETE...RETURNING via service-role RPC)
//   2. If state had no user_id, resolve from Supabase session cookie
//   3. Exchange code → tokens
//   4. Fetch ML user info
//   5. Upsert store + membership
//   6. Persist tokens
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { consumeOAuthState, exchangeCodeForTokens, getMeliUserFromAccessToken } from '@v2/lib/meli/oauth';
import { upsertStoreAndMembership } from '@v2/lib/stores/linkStore';
import { persistInstallationTokens, createPendingInstallation } from '@v2/lib/meli/installations';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type TokenExchangeStatus = 'ok' | 'fail';

interface DiagnosticPayload {
    has_code: boolean;
    has_state: boolean;
    has_error_param: boolean;
    error: string | null;
    error_description: string | null;
    has_verifier_cookie: boolean;
    verifier_cookie_length: number;
    has_state_cookie: boolean;
    state_cookie_length: number;
    token_exchange_status: TokenExchangeStatus;
    token_exchange_error_code: string | null;
    token_exchange_error_message: string | null;
    correlation_id: string;
    retry_url: string;
}

function sanitizeNext(raw: string | null): string | null {
    if (!raw) return null;
    if (!raw.startsWith('/')) return null;
    if (raw.startsWith('//')) return null;
    return raw;
}

function buildRetryUrl(nextPath: string | null): string {
    if (!nextPath) return '/api/auth/meli/start';
    return `/api/auth/meli/start?next=${encodeURIComponent(nextPath)}`;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function diagnosticHtml(payload: DiagnosticPayload): string {
    const lines = [
        `has_code: ${String(payload.has_code)}`,
        `has_state: ${String(payload.has_state)}`,
        `has_error_param: ${String(payload.has_error_param)}`,
        `error: ${payload.error ?? 'null'}`,
        `error_description: ${payload.error_description ?? 'null'}`,
        `has_verifier_cookie: ${String(payload.has_verifier_cookie)}`,
        `verifier_cookie_length: ${payload.verifier_cookie_length}`,
        `has_state_cookie: ${String(payload.has_state_cookie)}`,
        `state_cookie_length: ${payload.state_cookie_length}`,
        `token_exchange_status: ${payload.token_exchange_status}`,
        `token_exchange_error_code: ${payload.token_exchange_error_code ?? 'null'}`,
        `token_exchange_error_message: ${payload.token_exchange_error_message ?? 'null'}`,
        `correlation_id: ${payload.correlation_id}`,
        `retry_url: ${payload.retry_url}`,
    ];

    return `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;line-height:1.45">
    <pre>${escapeHtml(lines.join('\n'))}</pre>
    <a href="${escapeHtml(payload.retry_url)}">Reintentar conexión</a>
  </body>
</html>`;
}

function diagnosticResponse(payload: DiagnosticPayload, status = 400) {
    return new NextResponse(diagnosticHtml(payload), {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
    });
}

function extractTokenExchangeError(message: string): { code: string | null; detail: string } {
    const lower = message.toLowerCase();
    if (lower.includes('invalid_grant')) return { code: 'invalid_grant', detail: message };
    if (lower.includes('invalid_client')) return { code: 'invalid_client', detail: message };
    return { code: null, detail: message };
}

function appBaseUrl(request: NextRequest): string {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') ?? 'http';
    if (host) return `${proto}://${host}`;
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const correlationId = state ?? 'missing_state';
    const usePkce = process.env.MELI_USE_PKCE?.toLowerCase() !== 'false';
    const cookieStore = await cookies();
    const verifierCookie = cookieStore.get('meli_oauth_verifier')?.value ?? '';
    const stateCookie = cookieStore.get('meli_oauth_state')?.value ?? '';
    const nextQuery = sanitizeNext(url.searchParams.get('next'));
    const nextCookie = sanitizeNext(cookieStore.get('meli_oauth_next')?.value ?? null);
    const preservedNext = nextQuery ?? nextCookie;
    const retryUrl = buildRetryUrl(preservedNext);
    const baseDiagnostics = {
        has_code: Boolean(code),
        has_state: Boolean(state),
        has_error_param: false,
        error: null as string | null,
        error_description: null as string | null,
        has_verifier_cookie: usePkce ? verifierCookie.length > 0 : false,
        verifier_cookie_length: verifierCookie.length,
        has_state_cookie: stateCookie.length > 0,
        state_cookie_length: stateCookie.length,
        token_exchange_status: 'fail' as TokenExchangeStatus,
        token_exchange_error_code: null as string | null,
        token_exchange_error_message: null as string | null,
        correlation_id: correlationId,
        retry_url: retryUrl,
    };

    // ── Surface ML provider errors (e.g. user denied, app misconfigured) ─────
    const mlError = url.searchParams.get('error');
    const mlErrorDescription = url.searchParams.get('error_description');
    if (mlError) {
        console.error('[auth/meli/callback]', correlationId, 'ML returned error:', mlError, mlErrorDescription);
        return diagnosticResponse({
            ...baseDiagnostics,
            has_error_param: true,
            error: mlError,
            error_description: mlErrorDescription,
            token_exchange_error_code: mlError,
            token_exchange_error_message: mlErrorDescription ?? 'ML returned error parameter',
        });
    }

    if (!code || !state) {
        return diagnosticResponse({
            ...baseDiagnostics,
            token_exchange_error_message: 'Missing code or state',
        });
    }

    if (stateCookie && stateCookie !== state) {
        return diagnosticResponse({
            ...baseDiagnostics,
            token_exchange_error_message: 'State mismatch between callback and cookie context',
        });
    }

    try {
        // ── 1. Atomic state consumption (DELETE...RETURNING, service-role) ────
        const { codeVerifier, userId: stateUserId } = await consumeOAuthState(state);

        // ── 2. Resolve userId — prefer state, fallback to session cookie ──────
        let userId: string | null = stateUserId;
        if (!userId) {
            try {
                const supabaseUser = createServerClient(
                    process.env.NEXT_PUBLIC_SUPABASE_URL!,
                    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                    {
                        cookies: {
                            getAll: () => cookieStore.getAll(),
                            setAll: () => { },
                        },
                    },
                );
                const { data: { session } } = await supabaseUser.auth.getSession();
                userId = session?.user?.id ?? null;
                console.log(
                    '[auth/meli/callback] user_id resolved from session cookie:',
                    userId ?? 'null',
                );
            } catch (sessionErr) {
                console.warn('[auth/meli/callback]', correlationId, 'Could not read session cookie:', sessionErr);
            }
        }

        // ── 3. Exchange authorization code → tokens ───────────────────────────
        let tokens;
        try {
            tokens = await exchangeCodeForTokens(code, usePkce ? codeVerifier : undefined);
        } catch (tokenErr) {
            const message = tokenErr instanceof Error ? tokenErr.message : 'Token exchange failed';
            const parsed = extractTokenExchangeError(message);
            return diagnosticResponse({
                ...baseDiagnostics,
                token_exchange_status: 'fail',
                token_exchange_error_code: parsed.code,
                token_exchange_error_message: parsed.detail,
            });
        }

        // ── 4. Resolve Mercado Libre identity from /users/me ─────────────────
        let meliUser;
        try {
            meliUser = await getMeliUserFromAccessToken(tokens.access_token);
        } catch (meErr) {
            const message = meErr instanceof Error ? meErr.message : 'Failed to fetch Mercado Libre user';
            return diagnosticResponse({
                ...baseDiagnostics,
                token_exchange_error_message: message,
            });
        }

        const externalAccountId = meliUser?.id ? String(meliUser.id) : null;
        if (!externalAccountId) {
            return diagnosticResponse({
                ...baseDiagnostics,
                token_exchange_error_message: 'Mercado Libre /users/me response missing id',
            });
        }
        const displayName = meliUser?.nickname ? `ML ${meliUser.nickname}` : `ML ${externalAccountId}`;
        const tokenRawObject =
            typeof tokens.raw === 'object' && tokens.raw !== null
                ? (tokens.raw as Record<string, unknown>)
                : {};
        const enrichedRaw = {
            ...tokenRawObject,
            user_id: externalAccountId,
            nickname: meliUser?.nickname ?? null,
        };

        if (!userId) {
            console.log('[auth/meli/callback] No user in session. Creating pending installation.');
            const installationId = await createPendingInstallation({
                providerKey: 'mercadolibre',
                stateId: state,
                externalAccountId,
                tokens: { ...tokens, raw: enrichedRaw },
            });

            // Redirect to completion flow (it will require login)
            const installPath = `/install/meli/complete?installation_id=${installationId}`;
            const target = preservedNext ?? installPath;
            const response = NextResponse.redirect(new URL(target, appBaseUrl(request)));
            response.cookies.set('meli_oauth_state', '', { path: '/', maxAge: 0 });
            response.cookies.set('meli_oauth_verifier', '', { path: '/', maxAge: 0 });
            response.cookies.set('meli_oauth_next', '', { path: '/', maxAge: 0 });
            return response;
        }

        // ── 5. Upsert store + membership ──────────────────────────────────────
        const { storeId } = await upsertStoreAndMembership({
            userId,
            providerKey: 'mercadolibre',
            externalAccountId,
            displayName,
        });

        // ── 6. Persist tokens ─────────────────────────────────────────────────
        await persistInstallationTokens({
            storeId,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: tokens.expires_at,
            raw: enrichedRaw,
        });

        const target = preservedNext ?? '/post-login';
        const response = NextResponse.redirect(new URL(target, appBaseUrl(request)));
        response.cookies.set('meli_oauth_state', '', { path: '/', maxAge: 0 });
        response.cookies.set('meli_oauth_verifier', '', { path: '/', maxAge: 0 });
        response.cookies.set('meli_oauth_next', '', { path: '/', maxAge: 0 });
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'OAuth callback failed';
        console.error('[auth/meli/callback]', correlationId, message);
        const parsed = extractTokenExchangeError(message);
        return diagnosticResponse({
            ...baseDiagnostics,
            token_exchange_error_code: parsed.code,
            token_exchange_error_message: parsed.detail,
        });
    }
}
