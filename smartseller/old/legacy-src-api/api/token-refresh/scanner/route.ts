/**
 * Token Refresh - Scanner API
 * 
 * Scans for tokens nearing expiry and schedules refresh jobs
 * Cron: every 5 minutes
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { DistributedTokenRefreshScheduler } from '@/lib/token-refresh';

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
    const scheduler = new DistributedTokenRefreshScheduler();
    
    // Schedule proactive refreshes for Mercado Libre tokens
    const scheduled = await scheduler.scheduleProactiveRefreshes('mercadolibre');

    // Get current queue stats
    const { count: pendingCount } = await supabaseAdmin
      .from('token_refresh_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: processingCount } = await supabaseAdmin
      .from('token_refresh_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'processing');

    return NextResponse.json({
      success: true,
      scheduled,
      queueStats: {
        pending: pendingCount || 0,
        processing: processingCount || 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[TokenRefresh] Scanner error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
