-- ============================================================
-- SmartSeller V2 — Auth / OAuth / Memberships DDL
-- Migration: 20260224_v2_auth
-- ============================================================

-- 1. OAuth PKCE states
CREATE TABLE IF NOT EXISTS public.v2_oauth_states (
  state         text PRIMARY KEY,
  code_verifier text NOT NULL,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. ML OAuth tokens (one row per store)
CREATE TABLE IF NOT EXISTS public.v2_oauth_tokens (
  token_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES public.v2_stores(store_id) ON DELETE CASCADE,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invalid')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  raw           jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_v2_oauth_tokens_store
  ON public.v2_oauth_tokens(store_id);

-- 3. Store memberships (user <-> store, role)
CREATE TABLE IF NOT EXISTS public.v2_store_memberships (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.v2_tenants(tenant_id) ON DELETE CASCADE,
  store_id      uuid NOT NULL REFERENCES public.v2_stores(store_id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'operator', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_v2_store_memberships_user_store
  ON public.v2_store_memberships(user_id, store_id);

-- 4. display_name on v2_stores
ALTER TABLE public.v2_stores
  ADD COLUMN IF NOT EXISTS display_name text;

-- 5. RLS (idempotent via DO $$)
ALTER TABLE public.v2_store_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_stores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_clinical_signals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_health_scores      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'v2_store_memberships' AND policyname = 'memberships_select_own'
  ) THEN
    CREATE POLICY "memberships_select_own"
      ON public.v2_store_memberships FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'v2_stores' AND policyname = 'stores_select_if_member'
  ) THEN
    CREATE POLICY "stores_select_if_member"
      ON public.v2_stores FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.v2_store_memberships m
        WHERE m.store_id = v2_stores.store_id
          AND m.user_id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'v2_clinical_signals' AND policyname = 'signals_select_if_member'
  ) THEN
    CREATE POLICY "signals_select_if_member"
      ON public.v2_clinical_signals FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.v2_store_memberships m
        WHERE m.store_id = v2_clinical_signals.store_id
          AND m.user_id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'v2_health_scores' AND policyname = 'scores_select_if_member'
  ) THEN
    CREATE POLICY "scores_select_if_member"
      ON public.v2_health_scores FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.v2_store_memberships m
        WHERE m.store_id = v2_health_scores.store_id
          AND m.user_id = auth.uid()
      ));
  END IF;
END $$;
