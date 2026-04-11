-- Drop old constraint that lacks 'dead_letter', then recreate with full whitelist.
-- NOT VALID + VALIDATE = non-blocking on existing rows.
ALTER TABLE public.webhook_events
DROP CONSTRAINT IF EXISTS webhook_events_status_check;

ALTER TABLE public.webhook_events
ADD CONSTRAINT webhook_events_status_check
CHECK (status IN ('pending','processing','processed','done','failed','dead_letter'))
NOT VALID;

ALTER TABLE public.webhook_events
VALIDATE CONSTRAINT webhook_events_status_check;;
