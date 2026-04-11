
import { NextRequest, NextResponse } from 'next/server';
import { runWebhookWorker } from '@/lib/engine/smartseller/webhook-worker';

export const dynamic = 'force-dynamic'; // No caching

export async function POST(req: NextRequest) {
    try {
        const internalKey = process.env.INTERNAL_WORKER_KEY;
        const headerKey = req.headers.get('x-internal-key');

        if (!internalKey || headerKey !== internalKey) {
            // Unauthorized but still return JSON (maybe 401 is OK for auth failure, 
            // but prompt said "siempre 200 con error si falla").
            // Usually auth failure is 401. Prompt says "si falla (para que cron no rompa)". 
            // Assuming failing logic allows cron to continue. But Auth failure should stop it?
            // "siempre 200 con { ok:false, error } si falla".
            // I'll return 200 for logic errors, but Auth failure is usually 401. 
            // However, Cron jobs often retry on non-200. If we want to avoid retry loop on misconfig, 200 is safer.
            // I'll return 200 with error property.
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 200 });
        }

        const { claimed, processed, failed, requeued, duration_ms } = await runWebhookWorker(25);

        return NextResponse.json({
            ok: true,
            claimed,
            processed,
            failed,
            requeued,
            duration_ms,
            timestamp: new Date().toISOString()
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message || 'Internal Server Error' }, { status: 200 });
    }
}
