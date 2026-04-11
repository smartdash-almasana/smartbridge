BEGIN;

CREATE TABLE IF NOT EXISTS public.v3_store_v2_bridge (
  bridge_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key         text NOT NULL CHECK (provider_key IN ('mercadolibre')),
  external_account_id  text NOT NULL,
  tenant_id            uuid NOT NULL,
  store_id             uuid NOT NULL,
  v2_store_id          uuid NOT NULL,
  source               text NOT NULL DEFAULT 'v2_bridge' CHECK (source IN ('v2_bridge')),
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_key, external_account_id),
  UNIQUE (v2_store_id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES public.v3_stores (tenant_id, store_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (v2_store_id)
    REFERENCES public.v2_stores (store_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_v3_store_v2_bridge_tenant_store
  ON public.v3_store_v2_bridge (tenant_id, store_id);

DROP TRIGGER IF EXISTS trg_v3_store_v2_bridge_set_updated_at ON public.v3_store_v2_bridge;
CREATE TRIGGER trg_v3_store_v2_bridge_set_updated_at
BEFORE UPDATE ON public.v3_store_v2_bridge
FOR EACH ROW EXECUTE FUNCTION public.v3_set_updated_at();

ALTER TABLE public.v3_store_v2_bridge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS v3_store_v2_bridge_deny_anon ON public.v3_store_v2_bridge;
CREATE POLICY v3_store_v2_bridge_deny_anon
ON public.v3_store_v2_bridge
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS v3_store_v2_bridge_deny_authenticated ON public.v3_store_v2_bridge;
CREATE POLICY v3_store_v2_bridge_deny_authenticated
ON public.v3_store_v2_bridge
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

INSERT INTO public.v3_store_v2_bridge (
  provider_key,
  external_account_id,
  tenant_id,
  store_id,
  v2_store_id,
  source,
  is_active
)
SELECT
  'mercadolibre'::text,
  v2.external_account_id,
  v2.tenant_id,
  v2.store_id,
  v2.store_id,
  'v2_bridge'::text,
  true
FROM public.v2_stores v2
JOIN public.v3_stores v3
  ON v3.tenant_id = v2.tenant_id
 AND v3.store_id = v2.store_id
WHERE v2.provider_key = 'mercadolibre'
  AND v2.external_account_id IS NOT NULL
  AND length(trim(v2.external_account_id)) > 0
ON CONFLICT (provider_key, external_account_id)
DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  store_id = EXCLUDED.store_id,
  v2_store_id = EXCLUDED.v2_store_id,
  source = EXCLUDED.source,
  is_active = true,
  updated_at = now();

COMMIT;
