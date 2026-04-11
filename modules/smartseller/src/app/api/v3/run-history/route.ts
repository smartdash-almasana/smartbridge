import { NextRequest, NextResponse } from 'next/server';
import { readV3RunHistory, V3RunHistoryStoreNotFoundError } from '@/v3/read-models/run-history';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function isAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    if (!provided || !expected) return false;
    return provided === expected;
}

function parseLimit(rawLimit: string | null): number {
    const parsed = Number.parseInt((rawLimit ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_LIMIT);
}

export async function GET(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }

        const tenant_id = (request.nextUrl.searchParams.get('tenant_id') ?? '').trim();
        const store_id = (request.nextUrl.searchParams.get('store_id') ?? '').trim();
        const limit = parseLimit(request.nextUrl.searchParams.get('limit'));

        if (!tenant_id) {
            return NextResponse.json({ ok: false, error: 'Missing tenant_id' }, { status: 400 });
        }
        if (!store_id) {
            return NextResponse.json({ ok: false, error: 'Missing store_id' }, { status: 400 });
        }

        const result = await readV3RunHistory({ tenant_id, store_id, limit });
        return NextResponse.json({ ok: true, ...result }, { status: 200 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof V3RunHistoryStoreNotFoundError ? 404 : 500;
        return NextResponse.json({ ok: false, error: message }, { status });
    }
}
