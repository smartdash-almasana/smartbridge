
import { NextRequest, NextResponse } from 'next/server';
import { runClinicalEngineCycle } from '@/lib/engine/engine-runner';
import { supabaseAdmin } from '@/lib/supabase-server';

/**
 * Endpoint específico para Vercel Cron.
 * Valida mediante token en la URL ya que Vercel Cron no envía headers custom fácilmente.
 */
export async function GET(req: NextRequest) {
    const engineSecret = process.env.ENGINE_SECRET;
    const token = req.nextUrl.searchParams.get('token');

    // Si no hay secreto configurado en el env, bloqueamos por seguridad
    if (!engineSecret || token !== engineSecret) {
        console.error('[Engine][Cron] Unauthorized access attempt or missing ENGINE_SECRET');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');
    const oauthCleanupLimit = parseInt(process.env.OAUTH_STATE_CLEANUP_LIMIT || '100');

    try {
        console.log('[Engine][Cron] Triggering clinical cycle...');
        const summary = await runClinicalEngineCycle({
            sellerLimit: limit,
            dryRun: false
        });

        const cleanupSummary: {
            found_expired_unused: number;
            deleted: number;
            limit: number;
            error?: 'find_failed' | 'delete_failed' | 'unexpected';
        } = {
            found_expired_unused: 0,
            deleted: 0,
            limit: oauthCleanupLimit
        };

        try {
            const nowIso = new Date().toISOString();
            const { data: candidates, error: findError } = await supabaseAdmin
                .from('meli_oauth_states')
                .select('state')
                .is('used_at', null)
                .lt('expires_at', nowIso)
                .order('expires_at', { ascending: true })
                .limit(oauthCleanupLimit);

            if (findError) {
                console.error('[Engine][Cron] OAuth state cleanup find failed:', findError.message);
                cleanupSummary.error = 'find_failed';
            } else {
                const states = (candidates || []).map((row) => row.state);
                cleanupSummary.found_expired_unused = states.length;

                if (states.length > 0) {
                    const { data: deletedRows, error: deleteError } = await supabaseAdmin
                        .from('meli_oauth_states')
                        .delete()
                        .in('state', states)
                        .select('state');

                    if (deleteError) {
                        console.error('[Engine][Cron] OAuth state cleanup delete failed:', deleteError.message);
                        cleanupSummary.error = 'delete_failed';
                    } else {
                        cleanupSummary.deleted = deletedRows?.length || 0;
                    }
                }
            }
        } catch (cleanupError: any) {
            console.error('[Engine][Cron] OAuth state cleanup unexpected error:', cleanupError?.message || String(cleanupError));
            cleanupSummary.error = 'unexpected';
        }

        return NextResponse.json({
            ...summary,
            oauth_state_cleanup: cleanupSummary
        });
    } catch (error: any) {
        console.error('[Engine][Cron] Critical failure:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
