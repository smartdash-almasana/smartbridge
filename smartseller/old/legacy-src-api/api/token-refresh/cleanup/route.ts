/**
 * Token Refresh - Cleanup API
 * 
 * Cleans up stale locks and old completed jobs
 * Cron: 30 * * * * (hourly at minute 30)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

function validateCronAuth(req: NextRequest): { valid: boolean; error?: string } {
  const token = req.nextUrl.searchParams.get('token');
  const engineSecret = process.env.ENGINE_SECRET;

  if (!engineSecret) {
    console.error('[TokenRefresh] ENGINE_SECRET not configured');
    return { valid: false, error: 'Server configuration error' };
  }

  if (!token || token !== engineSecret) {
    console.error('[TokenRefresh] Unauthorized cron access attempt');
    return { valid: false, error: 'Unauthorized' };
  }

  return { valid: true };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = validateCronAuth(req);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  try {
    // Clean up stale locks
    const { data: cleanedLocks } = await supabaseAdmin.rpc('cleanup_stale_token_refresh_locks');

    // Clean up old completed jobs (keep last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: deletedJobs, error: deleteError } = await supabaseAdmin
      .from('token_refresh_jobs')
      .delete()
      .in('status', ['completed', 'cancelled'])
      .lt('completed_at', sevenDaysAgo.toISOString())
      .select('id');

    if (deleteError) {
      console.error('Failed to delete old jobs:', deleteError);
    }

    return NextResponse.json({
      success: true,
      cleanedLocks: cleanedLocks || 0,
      deletedJobs: deletedJobs?.length || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[TokenRefresh] Cleanup error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
