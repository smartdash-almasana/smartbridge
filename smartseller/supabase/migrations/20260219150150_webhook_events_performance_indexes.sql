-- 1️⃣ Partial index for claim performance
CREATE INDEX IF NOT EXISTS ix_webhook_events_pending_ready
  ON public.webhook_events (next_eligible_at)
  WHERE status = 'pending';

-- 2️⃣ Partial index for DLQ monitoring
CREATE INDEX IF NOT EXISTS ix_webhook_events_dead_letter
  ON public.webhook_events (id)
  WHERE status = 'dead_letter';

-- 3️⃣ Heartbeat performance index
CREATE INDEX IF NOT EXISTS ix_worker_heartbeats_last_seen
  ON public.worker_heartbeats (last_seen_at);

-- 4️⃣ Reduce HOT update bloat
ALTER TABLE public.webhook_events SET (fillfactor = 90);;
