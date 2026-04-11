CREATE TABLE public.v2_oauth_installations (
    installation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_key text NOT NULL,
    state_id text NOT NULL,
    external_account_id text NOT NULL,
    access_token text,
    refresh_token text,
    expires_at timestamptz,
    raw jsonb,
    created_at timestamptz DEFAULT now(),
    linked_store_id uuid NULL,
    linked_by_user_id uuid NULL,
    linked_at timestamptz NULL
);

-- RLS
ALTER TABLE public.v2_oauth_installations ENABLE ROW LEVEL SECURITY;

-- Allow service role to do everything
CREATE POLICY "Service role full access on installations"
    ON public.v2_oauth_installations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
;
