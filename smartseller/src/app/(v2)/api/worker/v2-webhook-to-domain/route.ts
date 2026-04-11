import { NextRequest, NextResponse } from 'next/server';
import {
    runV2WebhookToDomainWorker,
    runV2WebhookToDomainWorkerDlq,
} from '@v2/ingest/webhook-to-domain-worker';

function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function isAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    if (!provided || !expected) return false;
    return provided === expected;
}

function parseLimit(value: string | null): number {
    const n = Number(value ?? '50');
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(Math.floor(n), 200);
}

async function run(request: NextRequest, limit: number) {
    const mode = request.nextUrl.searchParams.get('mode');

    if (mode === 'dlq') {
        const result = await runV2WebhookToDomainWorkerDlq(limit);
        return NextResponse.json({ mode: 'dlq', ...result }, { status: 200 });
    }

    const result = await runV2WebhookToDomainWorker(limit);
    return NextResponse.json({ mode: 'normal', ...result }, { status: 200 });
}

export async function POST(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
        return await run(request, limit);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
        return await run(request, limit);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
