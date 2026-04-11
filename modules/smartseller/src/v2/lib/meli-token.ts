// ============================================================================
// SmartSeller V2 — ML Token Manager
// Single responsibility: retrieve a valid access_token for a store.
//
// Contract:
//   getValidToken(storeId)  →  access_token string (refreshed if needed)
//   refreshToken(storeId)   →  new token row (called internally)
//
// Rules:
//   - Refresh if token expires in < 2 minutes (120s safety window)
//   - On invalid_grant → mark status='invalid', throw ReauthorizationRequired
//   - Single-file, no duplication, no external callers for internal helpers
// ============================================================================

import { supabaseAdmin } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────
interface TokenRow {
    token_id: string;
    store_id: string;
    access_token: string;
    refresh_token: string;
    expires_at: string; // ISO string from Supabase
    status: 'active' | 'invalid';
}

interface MeliTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;        // seconds
    user_id: number;
    token_type: string;
}

type TokenSnapshot = Pick<TokenRow, 'access_token' | 'refresh_token' | 'expires_at' | 'status'>;

// ─── Sentinel error ───────────────────────────────────────────────────────────
export class ReauthorizationRequired extends Error {
    constructor(public readonly storeId: string) {
        super(`[meli-token] Re-authorization required for store ${storeId}`);
        this.name = 'ReauthorizationRequired';
    }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const MELI_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const REFRESH_WINDOW_MS = 120_000; // 2 minutes
const refreshLocks = new Map<string, Promise<string>>();

let readTokenSnapshotForStore: ((storeId: string) => Promise<TokenSnapshot | null>) | null = null;
let refreshTokenOverride: ((storeId: string) => Promise<string>) | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isExpiringSoon(expiresAt: string): boolean {
    const expiryMs = new Date(expiresAt).getTime();
    return expiryMs - Date.now() < REFRESH_WINDOW_MS;
}

function getEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`[meli-token] Missing env: ${key}`);
    return val;
}

// ─── Internal: exchange refresh_token for new pair ────────────────────────────
async function callMeliRefresh(refreshToken: string): Promise<MeliTokenResponse> {
    const res = await fetch(MELI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: getEnv('MELI_APP_ID'),
            client_secret: getEnv('MELI_CLIENT_SECRET'),
            refresh_token: refreshToken,
        }),
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const error = typeof body['error'] === 'string' ? body['error'] : 'unknown';
        throw new Error(`[meli-token] ML refresh HTTP ${res.status}: ${error}`);
    }

    return res.json() as Promise<MeliTokenResponse>;
}

// ─── Public: refresh and persist ──────────────────────────────────────────────
export async function refreshToken(storeId: string): Promise<string> {
    // 1. Read current refresh_token
    const { data: row, error: readErr } = await supabaseAdmin
        .from('v2_oauth_tokens')
        .select('refresh_token, status')
        .eq('store_id', storeId)
        .maybeSingle<Pick<TokenRow, 'refresh_token' | 'status'>>();

    if (readErr || !row) {
        throw new Error(`[meli-token] Token record not found for store ${storeId}`);
    }

    if (row.status === 'invalid') {
        throw new ReauthorizationRequired(storeId);
    }

    // 2. Call ML
    let meli: MeliTokenResponse;
    try {
        meli = await callMeliRefresh(row.refresh_token);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('invalid_grant') || msg.includes('401')) {
            // Mark invalid so future callers get the sentinel immediately
            await supabaseAdmin
                .from('v2_oauth_tokens')
                .update({ status: 'invalid', updated_at: new Date().toISOString() })
                .eq('store_id', storeId);
            throw new ReauthorizationRequired(storeId);
        }
        throw err;
    }

    const newExpiresAt = new Date(Date.now() + meli.expires_in * 1000).toISOString();

    // 3. Persist new tokens
    const { error: upsertErr } = await supabaseAdmin
        .from('v2_oauth_tokens')
        .update({
            access_token: meli.access_token,
            refresh_token: meli.refresh_token,
            expires_at: newExpiresAt,
            status: 'active',
            updated_at: new Date().toISOString(),
        })
        .eq('store_id', storeId);

    if (upsertErr) {
        throw new Error(`[meli-token] Failed to persist refreshed tokens: ${upsertErr.message}`);
    }

    return meli.access_token;
}

async function fetchTokenSnapshot(storeId: string): Promise<TokenSnapshot | null> {
    const { data: row, error } = await supabaseAdmin
        .from('v2_oauth_tokens')
        .select('access_token, refresh_token, expires_at, status')
        .eq('store_id', storeId)
        .maybeSingle<TokenSnapshot>();

    if (error) {
        throw new Error(`[meli-token] DB read error for store ${storeId}: ${error.message}`);
    }

    return row;
}

// ─── Public: main entry point ─────────────────────────────────────────────────
export async function getValidToken(storeId: string): Promise<string> {
    const row = readTokenSnapshotForStore
        ? await readTokenSnapshotForStore(storeId)
        : await fetchTokenSnapshot(storeId);

    if (!row) {
        throw new Error(`[meli-token] No token record for store ${storeId}`);
    }
    if (row.status === 'invalid') {
        throw new ReauthorizationRequired(storeId);
    }

    // If expiring soon, refresh transparently
    if (isExpiringSoon(row.expires_at)) {
        const existing = refreshLocks.get(storeId);
        if (existing) {
            return existing;
        }

        const refreshPromise = (refreshTokenOverride ?? refreshToken)(storeId);
        refreshLocks.set(storeId, refreshPromise);
        try {
            return await refreshPromise;
        } finally {
            if (refreshLocks.get(storeId) === refreshPromise) {
                refreshLocks.delete(storeId);
            }
        }
    }

    return row.access_token;
}

// Test-only hooks: keep runtime behavior unchanged when not configured.
export function __setMeliTokenTestHooks(hooks: {
    readTokenSnapshotForStore?: (storeId: string) => Promise<TokenSnapshot | null>;
    refreshToken?: (storeId: string) => Promise<string>;
}): void {
    readTokenSnapshotForStore = hooks.readTokenSnapshotForStore ?? null;
    refreshTokenOverride = hooks.refreshToken ?? null;
}

export function __resetMeliTokenTestHooks(): void {
    readTokenSnapshotForStore = null;
    refreshTokenOverride = null;
    refreshLocks.clear();
}

export function __getRefreshLocksSize(): number {
    return refreshLocks.size;
}
