/**
 * Token Refresh - DLQ Processor API
 * 
 * Processes dead letter queue entries
 * Cron: every 15 minutes
 */

import { NextRequest, NextResponse } from 'next/server';
import { TokenRefreshDLQProcessor } from '@/lib/token-refresh';

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
    const processor = new TokenRefreshDLQProcessor();
    const result = await processor.processDeadLetters();

    return NextResponse.json({
      success: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[TokenRefresh] DLQ processor error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
