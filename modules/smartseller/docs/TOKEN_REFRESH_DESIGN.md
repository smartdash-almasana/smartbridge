# Token Refresh Job Schedule & Retry Strategy Design

## Overview

Multi-tenant authentication subsystem supporting Mercado Libre (6-hour tokens) and future Shopify (24-hour tokens) with proactive refresh, intelligent retry policies, and distributed coordination.

---

## 1. Proactive Refresh Schedule

### 1.1 Token Lifetime by Platform

| Platform | Access Token TTL | Refresh Buffer | Proactive Refresh Window |
|----------|-----------------|----------------|-------------------------|
| Mercado Libre | 6 hours (21600s) | 10 minutes | 30 min before expiry |
| Shopify | 24 hours (86400s) | 15 minutes | 60 min before expiry |

### 1.2 Cron Expressions

```
# Primary refresh scanner - runs every 5 minutes
*/5 * * * *

# High-priority urgent refresh - runs every minute
* * * * *

# Dead letter queue processor - runs every 15 minutes
*/15 * * * *

# Cleanup/audit job - runs hourly at minute 30
30 * * * *
```

### 1.3 Refresh Scheduling Algorithm

```typescript
interface RefreshScheduleConfig {
  platform: 'mercadolibre' | 'shopify';
  tokenTTLSeconds: number;
  proactiveRefreshMinutes: number;
  urgentThresholdMinutes: number;
}

const PLATFORM_CONFIGS: Record<string, RefreshScheduleConfig> = {
  mercadolibre: {
    platform: 'mercadolibre',
    tokenTTLSeconds: 21600,      // 6 hours
    proactiveRefreshMinutes: 30,  // Refresh 30 min before expiry
    urgentThresholdMinutes: 5,    // Urgent if < 5 min remaining
  },
  shopify: {
    platform: 'shopify',
    tokenTTLSeconds: 86400,       // 24 hours
    proactiveRefreshMinutes: 60,  // Refresh 60 min before expiry
    urgentThresholdMinutes: 10,   // Urgent if < 10 min remaining
  },
};

function calculateRefreshPriority(
  expiresAt: Date,
  config: RefreshScheduleConfig
): 'normal' | 'urgent' | 'critical' {
  const minutesUntilExpiry = (expiresAt.getTime() - Date.now()) / 60000;
  
  if (minutesUntilExpiry <= config.urgentThresholdMinutes) {
    return 'critical';
  }
  if (minutesUntilExpiry <= config.proactiveRefreshMinutes) {
    return 'urgent';
  }
  return 'normal';
}
```

---

## 2. Retry Policies

### 2.1 Failure Classification

```typescript
type FailureCategory = 
  | 'TRANSIENT_NETWORK'      // Network timeouts, DNS failures
  | 'TRANSIENT_RATE_LIMIT'   // 429 Too Many Requests
  | 'TRANSIENT_SERVER'       // 5xx errors
  | 'PERMANENT_AUTH'         // Invalid grant, revoked tokens
  | 'PERMANENT_CONFIG'       // Missing credentials, bad setup
  | 'PERMANENT_PERMISSION';  // Insufficient scope

interface FailureClassifier {
  classify(error: unknown, platform: string): FailureCategory;
}

class TokenRefreshFailureClassifier implements FailureClassifier {
  classify(error: unknown, platform: string): FailureCategory {
    const err = error as any;
    
    // Network-level failures
    if (err.code === 'ECONNRESET' || 
        err.code === 'ETIMEDOUT' || 
        err.code === 'ENOTFOUND' ||
        err.message?.includes('network')) {
      return 'TRANSIENT_NETWORK';
    }
    
    // HTTP Status-based
    if (err.status === 429) {
      return 'TRANSIENT_RATE_LIMIT';
    }
    
    if (err.status >= 500 && err.status < 600) {
      return 'TRANSIENT_SERVER';
    }
    
    // Platform-specific auth errors
    if (platform === 'mercadolibre') {
      if (err.message?.includes('invalid_grant') || 
          err.status === 400 && err.error === 'invalid_grant') {
        return 'PERMANENT_AUTH';
      }
    }
    
    if (platform === 'shopify') {
      if (err.message?.includes('invalid_token') ||
          err.error === 'invalid_token') {
        return 'PERMANENT_AUTH';
      }
    }
    
    // Configuration errors
    if (err.status === 401 && err.message?.includes('client')) {
      return 'PERMANENT_CONFIG';
    }
    
    return 'TRANSIENT_NETWORK'; // Default to transient for unknown errors
  }
}
```

### 2.2 Retry Configuration by Failure Type

```typescript
interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryable: boolean;
  deadLetterAfterRetries: boolean;
}

const RETRY_POLICIES: Record<FailureCategory, RetryPolicy> = {
  TRANSIENT_NETWORK: {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryable: true,
    deadLetterAfterRetries: true,
  },
  TRANSIENT_RATE_LIMIT: {
    maxRetries: 10,
    baseDelayMs: 5000,  // Start higher for rate limits
    maxDelayMs: 60000,
    retryable: true,
    deadLetterAfterRetries: true,
  },
  TRANSIENT_SERVER: {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    retryable: true,
    deadLetterAfterRetries: true,
  },
  PERMANENT_AUTH: {
    maxRetries: 0,
    baseDelayMs: 0,
    maxDelayMs: 0,
    retryable: false,
    deadLetterAfterRetries: true, // Send to DLQ for reauthorization workflow
  },
  PERMANENT_CONFIG: {
    maxRetries: 0,
    baseDelayMs: 0,
    maxDelayMs: 0,
    retryable: false,
    deadLetterAfterRetries: true,
  },
  PERMANENT_PERMISSION: {
    maxRetries: 0,
    baseDelayMs: 0,
    maxDelayMs: 0,
    retryable: false,
    deadLetterAfterRetries: true,
  },
};
```

---

## 3. Exponential Backoff with Jitter

### 3.1 Backoff Formula

```typescript
/**
 * Calculates delay with exponential backoff and full jitter
 * 
 * Formula: delay = random(0, min(base * 2^attempt, maxDelay))
 * 
 * @param attempt - Current retry attempt (0-indexed)
 * @param baseDelayMs - Initial delay in milliseconds
 * @param maxDelayMs - Maximum delay cap
 * @returns Delay in milliseconds
 */
function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential component: base * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  
  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  // Apply full jitter: random value between 0 and cappedDelay
  // This prevents thundering herd when services recover
  const jitteredDelay = Math.random() * cappedDelay;
  
  return Math.floor(jitteredDelay);
}

/**
 * Alternative: Equal jitter (better for high-concurrency)
 * Formula: delay = (base * 2^attempt) / 2 + random(0, (base * 2^attempt) / 2)
 */
function calculateEqualJitterBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = Math.min(
    baseDelayMs * Math.pow(2, attempt),
    maxDelayMs
  );
  
  const halfDelay = exponentialDelay / 2;
  const jitter = Math.random() * halfDelay;
  
  return Math.floor(halfDelay + jitter);
}

/**
 * Platform-specific backoff with custom curves
 */
function calculatePlatformBackoff(
  attempt: number,
  policy: RetryPolicy,
  platform: string
): number {
  // Mercado Libre: More aggressive backoff due to stricter rate limits
  if (platform === 'mercadolibre') {
    const base = policy.baseDelayMs * 1.5;
    return calculateBackoffDelay(attempt, base, policy.maxDelayMs);
  }
  
  // Shopify: Standard backoff
  return calculateBackoffDelay(attempt, policy.baseDelayMs, policy.maxDelayMs);
}
```

### 3.2 Backoff Parameters Summary

| Failure Type | Base Delay | Max Delay | Backoff Strategy |
|--------------|-----------|-----------|------------------|
| Network | 1s | 30s | Exponential + Full Jitter |
| Rate Limit | 5s | 60s | Exponential + Equal Jitter |
| Server 5xx | 2s | 30s | Exponential + Full Jitter |

### 3.3 Retry Timeline Example (Network Failure)

```
Attempt 1: Immediate (0s)
Attempt 2: 0-1s (base: 1s)
Attempt 3: 0-2s (base: 2s)
Attempt 4: 0-4s (base: 4s)
Attempt 5: 0-8s (base: 8s)
Attempt 6: 0-16s (base: 16s) → DLQ if fails

Total max time: ~31 seconds
```

---

## 4. Dead Letter Queue (DLQ)

### 4.1 DLQ Schema

```sql
-- Token refresh dead letter queue
CREATE TABLE IF NOT EXISTS public.token_refresh_dlq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  platform TEXT NOT NULL, -- 'mercadolibre', 'shopify'
  user_id TEXT NOT NULL,
  failure_category TEXT NOT NULL,
  error_message TEXT,
  error_details JSONB,
  original_token_expires_at TIMESTAMPTZ,
  
  -- Retry tracking
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  
  -- Status workflow
  status TEXT NOT NULL DEFAULT 'pending_review' 
    CHECK (status IN ('pending_review', 'manual_resolved', 'auto_resolved', 'abandoned')),
  
  -- Resolution
  resolution_action TEXT, -- 'reauthorize', 'config_fix', 'manual_refresh', 'abandoned'
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for DLQ management
CREATE INDEX IF NOT EXISTS idx_token_refresh_dlq_status 
  ON public.token_refresh_dlq (status, created_at);

CREATE INDEX IF NOT EXISTS idx_token_refresh_dlq_tenant 
  ON public.token_refresh_dlq (tenant_id, platform);

CREATE INDEX IF NOT EXISTS idx_token_refresh_dlq_failure 
  ON public.token_refresh_dlq (failure_category);
```

### 4.2 DLQ Processing Workflow

```typescript
interface DLQProcessor {
  processDeadLetters(): Promise<DLQProcessResult>;
}

class TokenRefreshDLQProcessor implements DLQProcessor {
  async processDeadLetters(): Promise<DLQProcessResult> {
    const results: DLQProcessResult = {
      processed: 0,
      reauthorized: 0,
      autoRetried: 0,
      abandoned: 0,
      errors: [],
    };
    
    // 1. Fetch pending DLQ entries
    const { data: entries, error } = await supabaseAdmin
      .from('token_refresh_dlq')
      .select('*')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: true })
      .limit(100);
    
    if (error || !entries) {
      return { ...results, errors: [error?.message || 'No entries found'] };
    }
    
    for (const entry of entries) {
      try {
        const action = await this.determineResolutionAction(entry);
        
        switch (action) {
          case 'auto_retry_eligible':
            // Temporary issues that might resolve
            if (entry.attempts < 3) {
              await this.attemptAutoRetry(entry);
              results.autoRetried++;
            }
            break;
            
          case 'trigger_reauthorize':
            // Auth failures requiring user action
            await this.triggerReauthorizationWorkflow(entry);
            results.reauthorized++;
            break;
            
          case 'abandon':
            // Old entries (>7 days) with no resolution
            if (this.isAbandonCandidate(entry)) {
              await this.abandonEntry(entry);
              results.abandoned++;
            }
            break;
        }
        
        results.processed++;
      } catch (err) {
        results.errors.push(`Entry ${entry.id}: ${(err as Error).message}`);
      }
    }
    
    return results;
  }
  
  private async determineResolutionAction(
    entry: TokenRefreshDLQEntry
  ): Promise<string> {
    // Auto-retry transient failures within 1 hour
    if (entry.failure_category.startsWith('TRANSIENT') && 
        Date.now() - new Date(entry.created_at).getTime() < 3600000) {
      return 'auto_retry_eligible';
    }
    
    // Auth failures need reauthorization
    if (entry.failure_category === 'PERMANENT_AUTH') {
      return 'trigger_reauthorize';
    }
    
    // Abandon old entries
    if (Date.now() - new Date(entry.created_at).getTime() > 604800000) {
      return 'abandon';
    }
    
    return 'manual_review';
  }
  
  private isAbandonCandidate(entry: TokenRefreshDLQEntry): boolean {
    const ageHours = (Date.now() - new Date(entry.created_at).getTime()) / 3600000;
    return ageHours > 168; // 7 days
  }
}
```

---

## 5. Distributed Scheduling

### 5.1 Job Locking Schema

```sql
-- Distributed job locks for preventing duplicate refresh attempts
CREATE TABLE IF NOT EXISTS public.token_refresh_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  user_id TEXT NOT NULL,
  
  -- Job scheduling
  scheduled_at TIMESTAMPTZ NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' 
    CHECK (priority IN ('normal', 'urgent', 'critical')),
  
  -- Worker locking
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  locked_at TIMESTAMPTZ,
  locked_by TEXT, -- worker instance ID
  lock_expires_at TIMESTAMPTZ,
  
  -- Execution tracking
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uq_token_refresh_job UNIQUE (tenant_id, platform, user_id, scheduled_at)
);

-- Indexes for job management
CREATE INDEX IF NOT EXISTS idx_token_refresh_jobs_pending 
  ON public.token_refresh_jobs (status, priority, scheduled_at) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_token_refresh_jobs_locked 
  ON public.token_refresh_jobs (locked_by, locked_at) 
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_token_refresh_jobs_expiry 
  ON public.token_refresh_jobs (lock_expires_at) 
  WHERE status = 'processing';
```

### 5.2 Atomic Job Claim Function

```sql
-- Atomic job claiming with SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_token_refresh_jobs(
  batch_size INTEGER,
  worker_id TEXT,
  lock_duration_minutes INTEGER DEFAULT 5
)
RETURNS SETOF public.token_refresh_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  claimed_jobs public.token_refresh_jobs%ROWTYPE;
BEGIN
  -- Update jobs atomically and return them
  RETURN QUERY
  WITH claimable_jobs AS (
    SELECT j.id
    FROM public.token_refresh_jobs j
    WHERE j.status = 'pending'
      AND j.scheduled_at <= NOW()
      AND (
        j.locked_at IS NULL 
        OR j.lock_expires_at <= NOW()
      )
    ORDER BY 
      CASE j.priority
        WHEN 'critical' THEN 1
        WHEN 'urgent' THEN 2
        WHEN 'normal' THEN 3
      END,
      j.scheduled_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.token_refresh_jobs j
  SET 
    status = 'processing',
    locked_at = NOW(),
    locked_by = worker_id,
    lock_expires_at = NOW() + (lock_duration_minutes || ' minutes')::INTERVAL,
    started_at = NOW(),
    attempts = attempts + 1
  FROM claimable_jobs c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;
```

### 5.3 Job Scheduler Implementation

```typescript
interface TokenRefreshScheduler {
  scheduleRefresh(tenantId: string, userId: string, platform: string): Promise<void>;
  claimJobs(workerId: string, batchSize: number): Promise<RefreshJob[]>;
  completeJob(jobId: string, success: boolean, error?: string): Promise<void>;
}

class DistributedTokenRefreshScheduler implements TokenRefreshScheduler {
  async scheduleRefresh(
    tenantId: string,
    userId: string,
    platform: string
  ): Promise<void> {
    const config = PLATFORM_CONFIGS[platform];
    
    // Get current token expiry
    const { data: token } = await supabaseAdmin
      .from('meli_oauth_tokens')
      .select('expires_at')
      .eq('user_id', userId)
      .single();
    
    if (!token) return;
    
    const expiresAt = new Date(token.expires_at);
    const refreshAt = new Date(
      expiresAt.getTime() - config.proactiveRefreshMinutes * 60000
    );
    
    const priority = calculateRefreshPriority(expiresAt, config);
    
    // Upsert job (idempotent scheduling)
    await supabaseAdmin
      .from('token_refresh_jobs')
      .upsert({
        tenant_id: tenantId,
        platform,
        user_id: userId,
        scheduled_at: refreshAt.toISOString(),
        priority,
        status: 'pending',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,platform,user_id,scheduled_at',
      });
  }
  
  async claimJobs(workerId: string, batchSize: number): Promise<RefreshJob[]> {
    const { data: jobs, error } = await supabaseAdmin.rpc(
      'claim_token_refresh_jobs',
      {
        batch_size: batchSize,
        worker_id: workerId,
        lock_duration_minutes: 5,
      }
    );
    
    if (error) {
      throw new Error(`Failed to claim jobs: ${error.message}`);
    }
    
    return jobs || [];
  }
  
  async completeJob(
    jobId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await supabaseAdmin
      .from('token_refresh_jobs')
      .update({
        status: success ? 'completed' : 'failed',
        completed_at: new Date().toISOString(),
        error_message: error || null,
      })
      .eq('id', jobId);
  }
}
```

---

## 6. Platform-Specific Considerations

### 6.1 Mercado Libre Specifics

```typescript
const MELI_CONFIG = {
  tokenTTLSeconds: 21600,        // 6 hours
  refreshTokenRotates: true,     // ML rotates refresh tokens on each use
  rateLimitRequests: 100,        // Per minute
  rateLimitWindowMs: 60000,
  
  // Endpoints
  endpoints: {
    token: 'https://api.mercadolibre.com/oauth/token',
    test: 'https://api.mercadolibre.com/users/me',
  },
  
  // Error codes requiring reauthorization
  fatalErrors: ['invalid_grant', 'expired_token', 'access_denied'],
  
  // Retryable error codes
  retryableErrors: [
    'temporarily_unavailable',
    'server_error',
    'rate_limit_exceeded'
  ],
};

class MercadoLibreTokenStrategy {
  /**
   * ML rotates refresh tokens - must handle race conditions
   */
  async refreshWithRaceConditionHandling(
    userId: string,
    token: MeliToken
  ): Promise<MeliToken> {
    // Try refresh with current refresh_token
    try {
      return await this.doRefresh(userId, token.refresh_token);
    } catch (error: any) {
      // If invalid_grant, another worker may have already refreshed
      if (error.message?.includes('invalid_grant')) {
        // Re-fetch current token from DB
        const currentToken = await getActiveToken(userId);
        
        // If token was recently updated (within last minute), use it
        const updatedAt = new Date(currentToken.raw?.updated_at || 0);
        if (Date.now() - updatedAt.getTime() < 60000) {
          return currentToken;
        }
        
        // Otherwise, this is a real auth failure
        throw error;
      }
      
      throw error;
    }
  }
}
```

### 6.2 Shopify Specifics (Future-Ready)

```typescript
const SHOPIFY_CONFIG = {
  tokenTTLSeconds: 86400,        // 24 hours
  refreshTokenRotates: false,    // Shopify does NOT rotate refresh tokens
  rateLimitRequests: 40,         // Per app per store
  rateLimitWindowMs: 60000,
  
  // Shopify uses shop-specific subdomains
  getTokenEndpoint: (shop: string) => 
    `https://${shop}.myshopify.com/admin/oauth/access_token`,
  
  // Error handling
  fatalErrors: ['invalid_token', 'unauthorized', 'access_denied'],
  retryableErrors: ['throttled', 'internal_error', 'timeout'],
};
```

### 6.3 Token Refresh Orchestrator

```typescript
interface TokenRefreshOrchestrator {
  executeRefresh(job: RefreshJob): Promise<RefreshResult>;
}

class PlatformAwareTokenRefresher implements TokenRefreshOrchestrator {
  private classifiers: Map<string, FailureClassifier> = new Map();
  private strategies: Map<string, TokenRefreshStrategy> = new Map();
  
  constructor() {
    this.classifiers.set('mercadolibre', new MeliFailureClassifier());
    this.strategies.set('mercadolibre', new MercadoLibreTokenStrategy());
    
    // Future: this.strategies.set('shopify', new ShopifyTokenStrategy());
  }
  
  async executeRefresh(job: RefreshJob): Promise<RefreshResult> {
    const strategy = this.strategies.get(job.platform);
    if (!strategy) {
      throw new Error(`Unsupported platform: ${job.platform}`);
    }
    
    const classifier = this.classifiers.get(job.platform) || 
                       new TokenRefreshFailureClassifier();
    
    const policy = RETRY_POLICIES[job.failureCategory || 'TRANSIENT_NETWORK'];
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      try {
        const result = await strategy.refresh(job.user_id);
        return { success: true, token: result };
      } catch (error) {
        lastError = error as Error;
        const category = classifier.classify(error, job.platform);
        
        // Check if this is a permanent failure
        if (!RETRY_POLICIES[category].retryable) {
          await this.sendToDLQ(job, category, lastError);
          return { success: false, error: lastError, permanent: true };
        }
        
        // Calculate and wait for backoff
        if (attempt < policy.maxRetries) {
          const delay = calculatePlatformBackoff(
            attempt,
            policy,
            job.platform
          );
          await sleep(delay);
        }
      }
    }
    
    // Max retries exceeded
    await this.sendToDLQ(
      job,
      'TRANSIENT_NETWORK',
      lastError || new Error('Max retries exceeded')
    );
    
    return { 
      success: false, 
      error: lastError || new Error('Max retries exceeded'),
      permanent: false 
    };
  }
  
  private async sendToDLQ(
    job: RefreshJob,
    category: FailureCategory,
    error: Error
  ): Promise<void> {
    await supabaseAdmin.from('token_refresh_dlq').insert({
      tenant_id: job.tenant_id,
      platform: job.platform,
      user_id: job.user_id,
      failure_category: category,
      error_message: error.message,
      error_details: { stack: error.stack },
      attempts: job.attempts,
    });
  }
}
```

---

## 7. Job Orchestration Guidelines

### 7.1 Worker Architecture

```typescript
interface WorkerConfig {
  workerId: string;
  pollIntervalMs: number;
  batchSize: number;
  maxConcurrent: number;
  platforms: string[];
}

class TokenRefreshWorker {
  private isRunning = false;
  private activeRefreshes = new Map<string, AbortController>();
  
  constructor(
    private config: WorkerConfig,
    private scheduler: TokenRefreshScheduler,
    private orchestrator: TokenRefreshOrchestrator
  ) {}
  
  async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[Worker ${this.config.workerId}] Started`);
    
    while (this.isRunning) {
      try {
        await this.processBatch();
      } catch (error) {
        console.error(`[Worker ${this.config.workerId}] Batch error:`, error);
      }
      
      await sleep(this.config.pollIntervalMs);
    }
  }
  
  private async processBatch(): Promise<void> {
    // Claim jobs from queue
    const jobs = await this.scheduler.claimJobs(
      this.config.workerId,
      this.config.batchSize
    );
    
    if (jobs.length === 0) return;
    
    console.log(`[Worker ${this.config.workerId}] Processing ${jobs.length} jobs`);
    
    // Process with concurrency limit
    const semaphore = new Semaphore(this.config.maxConcurrent);
    
    await Promise.all(
      jobs.map(async (job) => {
        await semaphore.acquire();
        
        try {
          const controller = new AbortController();
          this.activeRefreshes.set(job.id, controller);
          
          const result = await Promise.race([
            this.orchestrator.executeRefresh(job),
            this.createTimeoutPromise(30000, controller),
          ]);
          
          await this.scheduler.completeJob(
            job.id,
            result.success,
            result.error?.message
          );
          
        } catch (error) {
          console.error(`[Worker ${this.config.workerId}] Job ${job.id} failed:`, error);
          await this.scheduler.completeJob(job.id, false, (error as Error).message);
        } finally {
          this.activeRefreshes.delete(job.id);
          semaphore.release();
        }
      })
    );
  }
  
  stop(): void {
    this.isRunning = false;
    
    // Abort all active refreshes
    for (const [jobId, controller] of this.activeRefreshes) {
      console.log(`[Worker ${this.config.workerId}] Aborting job ${jobId}`);
      controller.abort();
    }
  }
  
  private createTimeoutPromise(
    ms: number,
    controller: AbortController
  ): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        controller.abort();
        reject(new Error(`Refresh timeout after ${ms}ms`));
      }, ms);
    });
  }
}
```

### 7.2 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Token Refresh System                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Scanner    │  │    Urgent    │  │     DLQ      │          │
│  │  (5 min)     │  │  (1 min)     │  │  (15 min)    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                  │
│         ▼                 ▼                 ▼                  │
│  ┌──────────────────────────────────────────────────────┐     │
│  │         Token Refresh Job Queue (Postgres)           │     │
│  │  ┌──────────────────────────────────────────────┐   │     │
│  │  │ claim_token_refresh_jobs()                   │   │     │
│  │  │ - SKIP LOCKED for concurrency                │   │     │
│  │  │ - Priority ordering (critical > urgent)      │   │     │
│  │  │ - Expired lock reclamation                   │   │     │
│  │  └──────────────────────────────────────────────┘   │     │
│  └──────────────────────────────────────────────────────┘     │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │              Worker Pool (Horizontal)                │     │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐             │     │
│  │  │ Worker 1 │ │ Worker 2 │ │ Worker N │             │     │
│  │  │ (VM/Pod) │ │ (VM/Pod) │ │ (VM/Pod) │             │     │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘             │     │
│  │       │            │            │                   │     │
│  │       ▼            ▼            ▼                   │     │
│  │  ┌─────────────────────────────────────────────┐   │     │
│  │  │ Platform-Aware Refresh Orchestrator         │   │     │
│  │  │ - Exponential backoff with jitter           │   │     │
│  │  │ - Retry classification                      │   │     │
│  │  │ - Race condition handling (ML)              │   │     │
│  │  └─────────────────────────────────────────────┘   │     │
│  └──────────────────────────────────────────────────────┘     │
│         │                                                      │
│    ┌────┴────┬────────┐                                        │
│    ▼         ▼        ▼                                        │
│ ┌──────┐ ┌──────┐ ┌──────┐                                    │
│ │ Meli │ │Shopi-│ │Future│                                    │
│ │ API  │ │  fy  │ │Platforms                                  │
│ └──────┘ └──────┘ └──────┘                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Monitoring & Alerting

```typescript
interface TokenRefreshMetrics {
  // Recorded per refresh attempt
  recordAttempt(platform: string, success: boolean, durationMs: number): void;
  recordRetry(platform: string, failureCategory: string, attempt: number): void;
  recordDLQEntry(platform: string, category: string): void;
}

// Key metrics to track:
// - token_refresh_attempts_total (counter)
// - token_refresh_success_rate (gauge)  
// - token_refresh_duration_seconds (histogram)
// - token_retry_attempts_total (counter by category)
// - token_dlq_entries_total (counter)
// - token_dlq_age_seconds (histogram)
// - token_jobs_pending (gauge)
// - token_jobs_processing (gauge)
```

---

## 8. Summary: Key Parameters

### Timing Configuration

| Parameter | Mercado Libre | Shopify |
|-----------|---------------|---------|
| Access Token TTL | 6 hours | 24 hours |
| Proactive Refresh | 30 min before expiry | 60 min before expiry |
| Urgent Threshold | < 5 min remaining | < 10 min remaining |
| Scanner Frequency | Every 5 min | Every 5 min |
| Urgent Scanner | Every 1 min | Every 1 min |

### Retry Configuration

| Failure Type | Max Retries | Base Delay | Max Delay |
|--------------|-------------|------------|-----------|
| Network | 5 | 1s | 30s |
| Rate Limit | 10 | 5s | 60s |
| Server 5xx | 3 | 2s | 30s |
| Auth/Config | 0 | N/A | N/A (immediate DLQ) |

### Backoff Formula

```
delay = random(0, min(base * 2^attempt, maxDelay))

Where:
- attempt: 0-indexed retry attempt
- base: Platform-specific base delay
- maxDelay: Category-specific cap
- random: Uniform distribution for jitter
```

### Escalation Thresholds

1. **Auto-retry exhausted** → DLQ after 3-10 attempts (by category)
2. **DLQ auto-retry window** → 1 hour for transient failures
3. **DLQ abandonment** → 7 days without resolution
4. **Critical alert** → DLQ entries > 100 or age > 4 hours

---

## 9. Implementation Checklist

- [ ] Create `token_refresh_jobs` table with locking
- [ ] Create `token_refresh_dlq` table
- [ ] Implement `claim_token_refresh_jobs()` function
- [ ] Implement backoff calculation utilities
- [ ] Implement failure classification per platform
- [ ] Create worker pool with concurrency control
- [ ] Add platform-specific strategies (ML first)
- [ ] Implement DLQ processor with auto-retry
- [ ] Add monitoring metrics
- [ ] Create alerting rules for critical thresholds
- [ ] Write integration tests for race conditions
- [ ] Document operational runbooks
