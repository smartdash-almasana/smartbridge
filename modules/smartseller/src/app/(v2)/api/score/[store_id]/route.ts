import { getLatestScore } from '@v2/api/score';

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ store_id: string }> }
) {
    const { store_id } = await params;

    if (!store_id) {
        return Response.json({ error: 'Missing store_id' }, { status: 400 });
    }

    try {
        const score = await getLatestScore(store_id);
        if (!score) {
            return Response.json({ error: 'No score yet for this store' }, { status: 404 });
        }
        return Response.json(score, { status: 200 });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[GET /api/score]', message);
        return Response.json({ error: 'Score read failed' }, { status: 500 });
    }
}
