-- Add the two indexes specified in nuevadb.sql that are missing from live DB
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON public.webhook_events (status);

CREATE INDEX IF NOT EXISTS idx_webhook_events_seller
  ON public.webhook_events (provider_seller_id);;
