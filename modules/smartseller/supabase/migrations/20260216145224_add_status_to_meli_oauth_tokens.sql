ALTER TABLE public.meli_oauth_tokens ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.meli_oauth_tokens ADD COLUMN IF NOT EXISTS user_id_legacy TEXT;
UPDATE public.meli_oauth_tokens SET status = 'active' WHERE status IS NULL;;
