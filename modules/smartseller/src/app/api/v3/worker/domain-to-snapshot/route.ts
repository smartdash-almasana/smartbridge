import { NextRequest, NextResponse } from 'next/server';
import { runV3DomainToSnapshotWorker } from '@/v3/engine/domain-to-snapshot-worker';

function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function isAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
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

function parseLookbackDays(value: string | null): number {
    const n = Number(value ?? '30');
    if (!Number.isFinite(n) || n <= 0) return 30;
    return Math.min(Math.floor(n), 120);
}

async function run(limit: number, leaseSeconds: number, lookbackDays: number) {
    const result = await runV3DomainToSnapshotWorker(limit, leaseSeconds, lookbackDays);
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
        const lookbackDays = parseLookbackDays(request.nextUrl.searchParams.get('lookback_days'));
        return await run(limit, leaseSeconds, lookbackDays);
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
        const lookbackDays = parseLookbackDays(request.nextUrl.searchParams.get('lookback_days'));
        return await run(limit, leaseSeconds, lookbackDays);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}
