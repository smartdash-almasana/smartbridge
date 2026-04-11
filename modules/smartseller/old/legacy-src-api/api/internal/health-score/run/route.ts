
import { NextRequest, NextResponse } from 'next/server';
import { runDailyHealthScore } from '@/lib/engine/smartseller/health-score';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const internalKey = process.env.INTERNAL_WORKER_KEY;
        const headerKey = req.headers.get('x-internal-key');

        if (!internalKey || headerKey !== internalKey) {
            return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
        }

        const { computed } = await runDailyHealthScore(100); // Higher limit for daily run checks

        return NextResponse.json({
            ok: true,
            computed,
            timestamp: new Date().toISOString()
        });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
