/**
 * Token Refresh - Worker API
 * 
 * Runs a worker batch to process pending jobs
 * Can be triggered by cron or called programmatically
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  DistributedTokenRefreshScheduler,
  TokenRefreshWorker,
  PlatformAwareTokenRefresher,
  createWorkerConfig,
} from '@/lib/token-refresh';

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = validateCronAuth(req);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const workerId = `vercel-${Date.now()}`;
  
  try {
    const scheduler = new DistributedTokenRefreshScheduler();
    const orchestrator = new PlatformAwareTokenRefresher();
    
    const worker = new TokenRefreshWorker(
      createWorkerConfig(workerId, {
        batchSize: 20,
        maxConcurrent: 5,
        pollIntervalMs: 1000, // Short poll for single batch
      }),
      scheduler,
      orchestrator
    );

    // Process one batch and return stats
    // We'll manually trigger one batch instead of continuous polling
    const startTime = Date.now();
    
    // Claim and process one batch
    const jobs = await scheduler.claimJobs(workerId, 20);
    
    if (jobs.length === 0) {
      return NextResponse.json({
        success: true,
        workerId,
        jobsProcessed: 0,
        message: 'No jobs available',
        timestamp: new Date().toISOString(),
      });
    }

    // Process jobs
    const results = await Promise.all(
      jobs.map(async (job) => {
        try {
          const result = await orchestrator.executeRefresh(job);
          await scheduler.completeJob(
            job.id,
            result.success,
            result.error?.message,
            result.category
          );
          return { jobId: job.id, success: result.success };
        } catch (error) {
          await scheduler.completeJob(
            job.id,
            false,
            (error as Error).message,
            'TRANSIENT_NETWORK'
          );
          return { jobId: job.id, success: false, error: (error as Error).message };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;
    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      workerId,
      jobsProcessed: jobs.length,
      jobsSucceeded: successCount,
      jobsFailed: jobs.length - successCount,
      durationMs: duration,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[TokenRefresh] Worker error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
        workerId,
      },
      { status: 500 }
    );
  }
}
