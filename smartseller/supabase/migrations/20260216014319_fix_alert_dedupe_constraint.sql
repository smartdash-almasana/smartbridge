
-- Eliminar index anterior con coalesce
DROP INDEX IF EXISTS public.uq_alert_dedupe_15m;

-- Crear restricción única real que maneja NULLs como no distintos (Postgres 15+)
ALTER TABLE public.alert_events 
    ADD CONSTRAINT uq_alert_dedupe_15m 
    UNIQUE NULLS NOT DISTINCT (seller_uuid, alert_type, signal_key, bucket_15m);
;
