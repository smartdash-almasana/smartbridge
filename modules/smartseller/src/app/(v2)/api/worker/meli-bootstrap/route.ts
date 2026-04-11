import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@v2/lib/supabase';
import { getLatestScore } from '@v2/api/score';
import {
    BootstrapJobRow,
    runMeliBootstrapWorkerWithDeps,
} from './worker';

type BootstrapStatus = 'pending' | 'running' | 'completed' | 'failed';

const STALE_RUNNING_MS = 30 * 60_000;

function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function isAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    return Boolean(provided && expected && provided === expected);
}

function parseLimit(value: string | null): number {
    const n = Number(value ?? '5');
    if (!Number.isFinite(n) || n <= 0) return 5;
    return Math.min(Math.floor(n), 20);
}

function appBaseUrl(request: NextRequest): string {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') ?? 'http';
    if (host) return `${proto}://${host}`;
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

async function listCandidates(limit: number): Promise<BootstrapJobRow[]> {
    const { data, error } = await supabaseAdmin
        .from('v2_oauth_installations')
        .select('installation_id, linked_store_id, bootstrap_status')
        .not('linked_store_id', 'is', null)
        .or('bootstrap_status.eq.pending,bootstrap_status.eq.failed')
        .order('bootstrap_requested_at', { ascending: true, nullsFirst: true })
        .limit(Math.max(limit * 3, limit))
        .returns<BootstrapJobRow[]>();

    if (error) throw new Error(`[meli-bootstrap] list candidates failed: ${error.message}`);
    return data ?? [];
}

async function claimJob(installationId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('v2_oauth_installations')
        .update({
            bootstrap_status: 'running',
            bootstrap_started_at: now,
            bootstrap_error: null,
        })
        .eq('installation_id', installationId)
        .in('bootstrap_status', ['pending', 'failed'])
        .select('installation_id')
        .limit(1);

    if (error) throw new Error(`[meli-bootstrap] claim failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
}

async function markCompleted(installationId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
        .from('v2_oauth_installations')
        .update({
            bootstrap_status: 'completed',
            bootstrap_completed_at: now,
            bootstrap_error: null,
        })
        .eq('installation_id', installationId);

    if (error) throw new Error(`[meli-bootstrap] mark completed failed: ${error.message}`);
}

async function markFailed(installationId: string, message: string): Promise<void> {
    const { error } = await supabaseAdmin
        .from('v2_oauth_installations')
        .update({
            bootstrap_status: 'failed',
            bootstrap_error: message.slice(0, 2000),
        })
        .eq('installation_id', installationId);

    if (error) throw new Error(`[meli-bootstrap] mark failed failed: ${error.message}`);
}

async function markStaleRunningAsFailed(): Promise<number> {
    const cutoffIso = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
    const staleMessage = `bootstrap stale: exceeded ${Math.floor(STALE_RUNNING_MS / 60_000)}m running window`;

    const { data: staleNullStart, error: errNullStart } = await supabaseAdmin
        .from('v2_oauth_installations')
        .update({
            bootstrap_status: 'failed',
            bootstrap_error: staleMessage,
        })
        .eq('bootstrap_status', 'running')
        .not('linked_store_id', 'is', null)
        .is('bootstrap_started_at', null)
        .select('installation_id');

    if (errNullStart) throw new Error(`[meli-bootstrap] stale running sweep failed (null started_at): ${errNullStart.message}`);

    const { data: staleOldStart, error: errOldStart } = await supabaseAdmin
        .from('v2_oauth_installations')
        .update({
            bootstrap_status: 'failed',
            bootstrap_error: staleMessage,
        })
        .eq('bootstrap_status', 'running')
        .not('linked_store_id', 'is', null)
        .lt('bootstrap_started_at', cutoffIso)
        .select('installation_id');

    if (errOldStart) throw new Error(`[meli-bootstrap] stale running sweep failed (old started_at): ${errOldStart.message}`);
    return (staleNullStart?.length ?? 0) + (staleOldStart?.length ?? 0);
}

async function executeBootstrap(request: NextRequest, storeId: string): Promise<void> {
    const syncUrl = new URL(`/api/meli/sync/${storeId}`, appBaseUrl(request));
    syncUrl.searchParams.set('max_orders', '200');
    syncUrl.searchParams.set('historical', '1');

    const syncRes = await fetch(syncUrl.toString(), {
        method: 'POST',
        cache: 'no-store',
        headers: {
            'x-cron-secret': process.env.CRON_SECRET ?? '',
        },
    });
    if (!syncRes.ok) {
        const body = await syncRes.text();
        throw new Error(`[meli-bootstrap] historical sync failed (${syncRes.status}): ${body.slice(0, 300)}`);
    }

    await getLatestScore(storeId);
}

async function run(request: NextRequest, limit: number): Promise<NextResponse> {
    const summary = await runMeliBootstrapWorkerWithDeps(limit, {
        markStaleRunningAsFailed,
        listCandidates,
        claimJob,
        executeBootstrap: (storeId) => executeBootstrap(request, storeId),
        markCompleted,
        markFailed,
    });
    return NextResponse.json(summary, { status: 200 });
}

export async function GET(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
    try {
        return await run(request, limit);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    return GET(request);
}
