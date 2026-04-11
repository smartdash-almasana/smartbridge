BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.sellers (
  seller_uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text NOT NULL,
  external_id text NOT NULL,
  display_name text,
  market text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_key, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sellers_provider_external
  ON public.sellers (provider_key, external_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sellers_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_sellers_set_updated_at
    BEFORE UPDATE ON public.sellers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_uuid uuid NOT NULL REFERENCES public.sellers(seller_uuid) ON DELETE CASCADE,
  provider_key text NOT NULL,
  external_id text NOT NULL,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  band text NOT NULL CHECK (band IN ('green','yellow','red')),
  active_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_scores_seller_time
  ON public.health_scores (seller_uuid, calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_scores_provider_external_time
  ON public.health_scores (provider_key, external_id, calculated_at DESC);

CREATE TABLE IF NOT EXISTS public.clinical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_uuid uuid NOT NULL REFERENCES public.sellers(seller_uuid) ON DELETE CASCADE,
  provider_key text NOT NULL,
  external_id text NOT NULL,
  signal_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('medium','high','critical')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  metric_value numeric,
  threshold_reference numeric,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_clinical_events_active
  ON public.clinical_events (seller_uuid, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_events_signal_time
  ON public.clinical_events (signal_key, detected_at DESC);

CREATE TABLE IF NOT EXISTS public.signal_state (
  seller_uuid uuid NOT NULL REFERENCES public.sellers(seller_uuid) ON DELETE CASCADE,
  provider_key text NOT NULL,
  external_id text NOT NULL,
  signal_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('medium','high','critical')),
  status text NOT NULL CHECK (status IN ('active','resolved')),
  first_detected_at timestamptz NOT NULL,
  last_detected_at timestamptz NOT NULL,
  last_metric_value numeric,
  last_threshold_reference numeric,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (seller_uuid, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_signal_state_active
  ON public.signal_state (seller_uuid, status);

CREATE TABLE IF NOT EXISTS public.alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_uuid uuid NOT NULL REFERENCES public.sellers(seller_uuid) ON DELETE CASCADE,
  provider_key text NOT NULL,
  external_id text NOT NULL,
  signal_key text,
  alert_type text NOT NULL,
  severity text CHECK (severity IN ('medium','high','critical')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  bucket_15m bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_events_seller_time
  ON public.alert_events (seller_uuid, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_dedupe_15m
  ON public.alert_events (seller_uuid, alert_type, coalesce(signal_key,''), bucket_15m);

CREATE TABLE IF NOT EXISTS public.engine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_uuid uuid NOT NULL REFERENCES public.sellers(seller_uuid) ON DELETE CASCADE,
  provider_key text NOT NULL,
  external_id text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms integer,
  signals_detected integer NOT NULL DEFAULT 0,
  score integer,
  status text NOT NULL CHECK (status IN ('success','failed')),
  error_message text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_engine_runs_seller_time
  ON public.engine_runs (seller_uuid, started_at DESC);

COMMIT;;
