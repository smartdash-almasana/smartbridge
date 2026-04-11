
-- ============================================================
-- V2 Notification Policies — 2026-02-26
-- ============================================================

CREATE TABLE IF NOT EXISTS public.v2_notification_policies (
    policy_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid        NOT NULL,
    store_id     uuid        NOT NULL,
    enabled      boolean     NOT NULL DEFAULT true,
    channels     jsonb       NOT NULL DEFAULT '{}',
    quiet_hours  jsonb       NOT NULL DEFAULT '{}',
    rules        jsonb       NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (store_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_notification_policies_tenant_store
    ON public.v2_notification_policies (tenant_id, store_id);

-- RLS
ALTER TABLE public.v2_notification_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS v2_policies_select ON public.v2_notification_policies;
CREATE POLICY v2_policies_select ON public.v2_notification_policies
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.v2_store_memberships m
            WHERE m.store_id  = v2_notification_policies.store_id
              AND m.tenant_id = v2_notification_policies.tenant_id
              AND m.user_id   = auth.uid()
        )
    );

DROP POLICY IF EXISTS v2_policies_insert ON public.v2_notification_policies;
CREATE POLICY v2_policies_insert ON public.v2_notification_policies
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.v2_store_memberships m
            WHERE m.store_id  = v2_notification_policies.store_id
              AND m.tenant_id = v2_notification_policies.tenant_id
              AND m.user_id   = auth.uid()
        )
    );

DROP POLICY IF EXISTS v2_policies_update ON public.v2_notification_policies;
CREATE POLICY v2_policies_update ON public.v2_notification_policies
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.v2_store_memberships m
            WHERE m.store_id  = v2_notification_policies.store_id
              AND m.tenant_id = v2_notification_policies.tenant_id
              AND m.user_id   = auth.uid()
        )
    );
;
