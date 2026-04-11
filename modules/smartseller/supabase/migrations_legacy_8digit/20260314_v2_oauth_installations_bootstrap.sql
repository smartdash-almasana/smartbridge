-- ============================================================================
-- SmartSeller V2 — Initial Bootstrap state for OAuth installations
-- Migration: 20260314_v2_oauth_installations_bootstrap
-- ============================================================================

ALTER TABLE public.v2_oauth_installations
  ADD COLUMN IF NOT EXISTS bootstrap_status text
    CHECK (bootstrap_status IN ('pending', 'running', 'completed', 'failed'));

ALTER TABLE public.v2_oauth_installations
  ADD COLUMN IF NOT EXISTS bootstrap_requested_at timestamptz;

ALTER TABLE public.v2_oauth_installations
  ADD COLUMN IF NOT EXISTS bootstrap_started_at timestamptz;

ALTER TABLE public.v2_oauth_installations
  ADD COLUMN IF NOT EXISTS bootstrap_completed_at timestamptz;

ALTER TABLE public.v2_oauth_installations
  ADD COLUMN IF NOT EXISTS bootstrap_error text;

ALTER TABLE public.v2_oauth_installations
  ADD COLUMN IF NOT EXISTS bootstrap_version text;

CREATE INDEX IF NOT EXISTS idx_v2_oauth_installations_bootstrap_queue
  ON public.v2_oauth_installations (bootstrap_status, bootstrap_requested_at)
  WHERE linked_store_id IS NOT NULL;
