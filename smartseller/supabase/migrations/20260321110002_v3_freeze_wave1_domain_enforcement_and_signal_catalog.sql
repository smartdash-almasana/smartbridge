BEGIN;

ALTER TABLE public.v3_domain_events
  DROP CONSTRAINT IF EXISTS v3_domain_events_event_type_format_ck;
ALTER TABLE public.v3_domain_events
  ADD CONSTRAINT v3_domain_events_event_type_format_ck
  CHECK (
    length(trim(event_type)) > 0
    AND event_type ~ '^[a-z0-9_]+\.[a-z0-9_]+$'
  ) NOT VALID;

ALTER TABLE public.v3_domain_events
  DROP CONSTRAINT IF EXISTS v3_domain_events_entity_type_format_ck;
ALTER TABLE public.v3_domain_events
  ADD CONSTRAINT v3_domain_events_entity_type_format_ck
  CHECK (
    length(trim(entity_type)) > 0
    AND entity_type ~ '^[a-z0-9_]+$'
  ) NOT VALID;

CREATE TABLE IF NOT EXISTS public.v3_signal_catalog (
  signal_key   text PRIMARY KEY,
  description  text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_v3_signal_catalog_set_updated_at ON public.v3_signal_catalog;
CREATE TRIGGER trg_v3_signal_catalog_set_updated_at
BEFORE UPDATE ON public.v3_signal_catalog
FOR EACH ROW EXECUTE FUNCTION public.v3_set_updated_at();

ALTER TABLE public.v3_signal_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS v3_signal_catalog_deny_anon ON public.v3_signal_catalog;
CREATE POLICY v3_signal_catalog_deny_anon
ON public.v3_signal_catalog
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_signal_catalog_deny_authenticated ON public.v3_signal_catalog;
CREATE POLICY v3_signal_catalog_deny_authenticated
ON public.v3_signal_catalog
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

INSERT INTO public.v3_signal_catalog (signal_key, description, is_active)
VALUES
  ('source_webhook_events_1d_zero', 'No webhook events detected for current metric day', true),
  ('source_domain_events_lag_1d', 'Gap between webhook and domain events in current metric day', true),
  ('no_orders_7d', 'No orders detected in rolling 7-day window', true)
ON CONFLICT (signal_key) DO UPDATE
SET description = EXCLUDED.description,
    is_active = EXCLUDED.is_active;

ALTER TABLE public.v3_clinical_signals
  DROP CONSTRAINT IF EXISTS v3_clinical_signals_signal_key_fk;
ALTER TABLE public.v3_clinical_signals
  ADD CONSTRAINT v3_clinical_signals_signal_key_fk
  FOREIGN KEY (signal_key)
  REFERENCES public.v3_signal_catalog(signal_key)
  ON UPDATE RESTRICT
  ON DELETE RESTRICT
  NOT VALID;

COMMIT;
