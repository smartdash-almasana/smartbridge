import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

type SectionError = {
  ok: false;
  error: "missing_view" | string;
};

type EngineStatus = "healthy" | "degraded" | "critical";

function normalizeSecret(value: string): string {
  return value.replace(/\r/g, "").replace(/\n/g, "").trim();
}

function isMissingViewError(error: unknown): boolean {
  const err = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  const haystack = `${err?.message ?? ""} ${err?.details ?? ""} ${err?.hint ?? ""}`.toLowerCase();
  return err?.code === "PGRST205" || haystack.includes("could not find the table") || haystack.includes("does not exist");
}

async function selectSingleOrMissing(viewName: string): Promise<Record<string, unknown> | SectionError> {
  const { data, error } = await supabaseAdmin.from(viewName).select("*").limit(1).maybeSingle();

  if (error) {
    if (isMissingViewError(error)) {
      return { ok: false, error: "missing_view" };
    }
    return { ok: false, error: error.message || "query_error" };
  }

  return (data ?? {}) as Record<string, unknown>;
}

async function selectListOrMissing(viewName: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabaseAdmin.from(viewName).select("*");

  if (error) {
    if (isMissingViewError(error)) {
      return [];
    }
    return [];
  }

  return (data ?? []) as Array<Record<string, unknown>>;
}

function validateCronAuth(req: NextRequest): boolean {
  const provided = normalizeSecret(req.headers.get("x-cron-secret") ?? "");
  const expected = normalizeSecret(process.env.CRON_SECRET ?? "");

  return !!expected && provided === expected;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isMissingViewSection(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const section = value as { ok?: unknown; error?: unknown };
  return section.ok === false && section.error === "missing_view";
}

type WorkerStats = { active_workers: number; stale_workers: number };
type DlqStats = { dead_letter_events: number };

function deriveEngineStatus(
  queueHealth: Record<string, unknown> | SectionError,
  retryMonitor: Record<string, unknown> | SectionError,
  lockStatus: Array<Record<string, unknown>>,
  workerStats: WorkerStats,
  dlqStats: DlqStats
): EngineStatus {
  if (isMissingViewSection(queueHealth) || isMissingViewSection(retryMonitor)) {
    return "degraded";
  }

  const staleProcessing = toNumber((queueHealth as Record<string, unknown>)?.stale_processing);
  const pendingEvents = toNumber((queueHealth as Record<string, unknown>)?.pending_events);
  const maxAttempts = toNumber((retryMonitor as Record<string, unknown>)?.max_attempts);
  const retryingEvents = toNumber((retryMonitor as Record<string, unknown>)?.retrying_events);
  const lockCount = Array.isArray(lockStatus) ? lockStatus.length : 0;

  if (
    staleProcessing > 0 ||
    maxAttempts >= 5 ||
    lockCount > 10 ||
    workerStats.stale_workers > 0 ||
    workerStats.active_workers === 0 ||
    dlqStats.dead_letter_events > 20
  ) {
    return "critical";
  }

  if (pendingEvents > 100 || retryingEvents > 5 || dlqStats.dead_letter_events > 5) {
    return "degraded";
  }

  return "healthy";
}

async function fetchWorkerStats(): Promise<WorkerStats> {
  try {
    const { data, error } = await supabaseAdmin
      .from("worker_heartbeats")
      .select("last_seen_at");

    if (error) return { active_workers: 0, stale_workers: 0 };

    const now = Date.now();
    const rows = (data ?? []) as Array<{ last_seen_at: string }>;
    const active = rows.filter((r) => now - new Date(r.last_seen_at).getTime() < 60_000).length;
    const stale = rows.filter((r) => now - new Date(r.last_seen_at).getTime() >= 180_000).length;
    return { active_workers: active, stale_workers: stale };
  } catch {
    return { active_workers: 0, stale_workers: 0 };
  }
}

async function fetchDlqStats(): Promise<DlqStats> {
  try {
    const { count, error } = await supabaseAdmin
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead_letter");

    if (error) return { dead_letter_events: 0 };
    return { dead_letter_events: count ?? 0 };
  } catch {
    return { dead_letter_events: 0 };
  }
}

type ThroughputStats = {
  last_minute_claimed: number;
  last_minute_processed: number;
  last_minute_failed: number;
};

async function fetchThroughputStats(): Promise<ThroughputStats> {
  const zero: ThroughputStats = { last_minute_claimed: 0, last_minute_processed: 0, last_minute_failed: 0 };
  try {
    const bucket = new Date();
    bucket.setSeconds(0, 0);

    const { data, error } = await supabaseAdmin
      .from("runtime_metrics_minute")
      .select("claimed_count, processed_count, failed_count")
      .eq("bucket_minute", bucket.toISOString());

    if (error) return zero;

    const rows = (data ?? []) as Array<{ claimed_count: number; processed_count: number; failed_count: number }>;
    return {
      last_minute_claimed: rows.reduce((s, r) => s + (r.claimed_count ?? 0), 0),
      last_minute_processed: rows.reduce((s, r) => s + (r.processed_count ?? 0), 0),
      last_minute_failed: rows.reduce((s, r) => s + (r.failed_count ?? 0), 0),
    };
  } catch {
    return zero;
  }
}

export async function GET(req: NextRequest) {
  if (!validateCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const [queueHealth, processingLatency, retryMonitor, lockStatus, workerStats, dlqStats, throughput] = await Promise.all([
    selectSingleOrMissing("queue_health"),
    selectSingleOrMissing("processing_latency"),
    selectSingleOrMissing("retry_monitor"),
    selectListOrMissing("lock_status"),
    fetchWorkerStats(),
    fetchDlqStats(),
    fetchThroughputStats(),
  ]);
  const engineStatus = deriveEngineStatus(queueHealth, retryMonitor, lockStatus, workerStats, dlqStats);

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    queue_health: queueHealth,
    processing_latency: processingLatency,
    retry_monitor: retryMonitor,
    lock_status: lockStatus,
    workers: workerStats,
    dlq: dlqStats,
    throughput,
    engine_status: engineStatus,
  });
}
