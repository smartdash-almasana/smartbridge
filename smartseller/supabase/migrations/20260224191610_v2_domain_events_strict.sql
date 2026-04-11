DROP INDEX IF EXISTS idx_v2_domain_events_seller_uuid;
DROP INDEX IF EXISTS idx_v2_domain_events_occurred_at;
DROP INDEX IF EXISTS idx_v2_domain_events_entity;

ALTER TABLE public.v2_domain_events
  DROP COLUMN IF EXISTS store_id,
  DROP COLUMN IF EXISTS seller_uuid;

ALTER TABLE public.v2_domain_events
  DROP CONSTRAINT IF EXISTS uq_v2_domain_events_store_source_type;

ALTER TABLE public.v2_domain_events
  DROP CONSTRAINT IF EXISTS uq_v2_domain_events_source_type;

ALTER TABLE public.v2_domain_events
  ADD CONSTRAINT uq_v2_domain_events_source_type
    UNIQUE (source_event_id, event_type);

CREATE INDEX IF NOT EXISTS idx_v2_domain_events_occurred_at
  ON public.v2_domain_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_v2_domain_events_entity
  ON public.v2_domain_events (entity_type, entity_id);;
