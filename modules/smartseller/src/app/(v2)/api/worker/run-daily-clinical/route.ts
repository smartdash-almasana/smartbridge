import { NextRequest, NextResponse } from 'next/server';
import { runDailyClinicalV0 } from '@v2/engine/run-daily-clinical-v0';

function normalizeSecret(value: string): string {
    return value.replace(/[\r\n\t\s]+/g, '').trim();
}

function isAuthorized(request: NextRequest): boolean {
    const provided = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
    const expected = normalizeSecret(process.env.CRON_SECRET ?? '');
    if (!provided || !expected) return false;
    return provided === expected;
}

interface DailyClinicalRequestBody {
    tenant_id?: string;
    store_id?: string;
    metric_date?: string;
}

function pickInputFromRequest(request: NextRequest, body?: DailyClinicalRequestBody) {
    const tenant_id = (body?.tenant_id ?? request.nextUrl.searchParams.get('tenant_id') ?? '').trim();
    const store_id = (body?.store_id ?? request.nextUrl.searchParams.get('store_id') ?? '').trim();
    const metric_date = (body?.metric_date ?? request.nextUrl.searchParams.get('metric_date') ?? '').trim();

    return {
        tenant_id,
        store_id,
        metric_date: metric_date || undefined,
    };
}

function badRequest(message: string) {
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

async function run(request: NextRequest, body?: DailyClinicalRequestBody) {
    const input = pickInputFromRequest(request, body);

    if (!input.tenant_id) return badRequest('Missing required tenant_id');
    if (!input.store_id) return badRequest('Missing required store_id');

    const result = await runDailyClinicalV0(input);
    const status = result.success ? 200 : 500;

    return NextResponse.json(
        {
            ok: result.success,
            run_id: result.run_id ?? null,
            snapshot_id: result.snapshot_id ?? null,
            early_return: result.early_return ?? false,
            reason: result.reason ?? null,
            metric_date: input.metric_date ?? new Date().toISOString().slice(0, 10),
            results: result.results ?? null,
            error: result.error ?? null,
            partial_results: result.partial_results ?? null,
        },
        { status }
    );
}

export async function GET(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return await run(request);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body: DailyClinicalRequestBody | undefined;
        const contentType = request.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
            body = (await request.json()) as DailyClinicalRequestBody;
        }

        return await run(request, body);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}
