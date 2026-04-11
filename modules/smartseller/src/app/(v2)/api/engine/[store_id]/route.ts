import { runEngineForStore } from '@v2/engine/runner';

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ store_id: string }> }
) {
    const { store_id } = await params;

    if (!store_id) {
        return Response.json({ error: 'Missing store_id' }, { status: 400 });
    }

    try {
        const result = await runEngineForStore(store_id);
        return Response.json(result, { status: 200 });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[POST /api/engine]', message);
        return Response.json({ error: 'Engine run failed' }, { status: 500 });
    }
}
