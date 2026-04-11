import { NextRequest, NextResponse } from 'next/server';
import { runV3WebhookToDomainWorker } from '@/v3/ingest/webhook-to-domain-worker';

function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function extractBearerToken(value: string): string {
    const normalized = normalizeSecret(value);
    const prefix = 'Bearer ';
    if (!normalized.startsWith(prefix)) return '';
    return normalizeSecret(normalized.slice(prefix.length));
}

function isAuthorized(request: NextRequest): boolean {
    const providedHeader = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const providedBearer = extractBearerToken(request.headers.get('authorization') ?? '');
    const provided = providedHeader || providedBearer;
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    if (!provided || !expected) return false;
    return provided === expected;
}

function isRepairFrozen(): boolean {
    return (process.env.V3_REPAIR_FREEZE ?? '').trim() === '1';
}

function parseLimit(value: string | null): number {
    const n = Number(value ?? '50');
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(Math.floor(n), 200);
}

function parseLeaseSeconds(value: string | null): number {
    const n = Number(value ?? '300');
    if (!Number.isFinite(n) || n <= 0) return 300;
    return Math.min(Math.floor(n), 3600);
}

async function run(limit: number, leaseSeconds: number) {
    const result = await runV3WebhookToDomainWorker(limit, leaseSeconds);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
}

export async function GET(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }
        if (isRepairFrozen()) {
            return NextResponse.json({ ok: false, error: 'V3 repair freeze enabled' }, { status: 503 });
        }
        const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
        const leaseSeconds = parseLeaseSeconds(request.nextUrl.searchParams.get('lease_seconds'));
        return await run(limit, leaseSeconds);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }
        if (isRepairFrozen()) {
            return NextResponse.json({ ok: false, error: 'V3 repair freeze enabled' }, { status: 503 });
        }
        const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
        const leaseSeconds = parseLeaseSeconds(request.nextUrl.searchParams.get('lease_seconds'));
        return await run(limit, leaseSeconds);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}
