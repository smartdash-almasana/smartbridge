/**
 * Token Refresh - Urgent Scanner API
 * 
 * Handles critical priority tokens (< 5 minutes to expiry)
 * Cron: * * * * * (every minute)
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
    // Find tokens in critical window (< 5 min for ML)
    const criticalThreshold = new Date(Date.now() + 5 * 60 * 1000);
    
    const { data: urgentTokens, error } = await supabaseAdmin
      .from('meli_oauth_tokens')
      .select('user_id, expires_at, tenant_id')
      .eq('status', 'active')
      .lte('expires_at', criticalThreshold.toISOString())
      .gte('expires_at', new Date().toISOString());

    if (error) {
      throw error;
    }

    const scheduler = new DistributedTokenRefreshScheduler();
    let scheduled = 0;

    for (const token of urgentTokens || []) {
      try {
        await scheduler.scheduleRefresh({
          tenantId: token.tenant_id || 'default',
          userId: token.user_id,
          platform: 'mercadolibre',
          scheduledAt: new Date(), // Immediate
          priority: 'critical',
          tokenExpiresAt: new Date(token.expires_at),
        });
        scheduled++;
      } catch (err) {
        console.error(`Failed to schedule urgent refresh for ${token.user_id}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      urgentTokensFound: urgentTokens?.length || 0,
      scheduled,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[TokenRefresh] Urgent scanner error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
