-- nuevadb.sql defines idx_webhook_events_claimable on (next_eligible_at)
-- Live DB has it on (received_at). We drop and recreate to match canonical.
DROP INDEX IF EXISTS public.idx_webhook_events_claimable;

CREATE INDEX IF NOT EXISTS idx_webhook_events_claimable
  ON public.webhook_events (next_eligible_at)
  WHERE status = 'pending';;
