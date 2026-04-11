-- Add UNIQUE constraint on source_event_id alone so that the worker's
-- ON CONFLICT (source_event_id) DO NOTHING upsert resolves correctly.
-- The existing uq_v2_domain_events_source_type (source_event_id, event_type) is kept intact.
ALTER TABLE public.v2_domain_events
    ADD CONSTRAINT uq_v2_domain_events_source_event_id
    UNIQUE (source_event_id);;
