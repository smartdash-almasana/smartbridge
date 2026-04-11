-- Same issue: existing function has defaults, nuevadb.sql has none. DROP and recreate.
-- Callers in clinical-locks.ts always pass all three args, so removing defaults is safe.
DROP FUNCTION IF EXISTS public.acquire_clinical_lock(text, integer, text);

CREATE FUNCTION public.acquire_clinical_lock(
  p_job_key     text,
  p_ttl_seconds int,
  p_locked_by   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts timestamptz := now();
BEGIN
  LOOP
    -- Attempt INSERT (first-call or after expiry with no row)
    INSERT INTO public.job_locks (job_key, locked_until, locked_by, updated_at)
    VALUES (p_job_key, now_ts + (p_ttl_seconds || ' seconds')::interval, p_locked_by, now_ts)
    ON CONFLICT (job_key) DO NOTHING;

    -- Attempt to claim the row if unlocked or expired
    UPDATE public.job_locks
    SET
      locked_until = now_ts + (p_ttl_seconds || ' seconds')::interval,
      locked_by    = p_locked_by,
      updated_at   = now_ts
    WHERE job_key = p_job_key
      AND (locked_until IS NULL OR locked_until < now_ts)
    RETURNING true INTO now_ts;

    IF FOUND THEN
      RETURN true;
    END IF;

    -- Another worker holds a live lock
    IF EXISTS (
      SELECT 1 FROM public.job_locks
      WHERE job_key = p_job_key
        AND locked_until > now_ts
    ) THEN
      RETURN false;
    END IF;

    -- Edge case: concurrent expiry loop — retry
  END LOOP;
END;
$$;

ALTER  FUNCTION public.acquire_clinical_lock(text, int, text) OWNER TO postgres;
REVOKE ALL     ON FUNCTION public.acquire_clinical_lock(text, int, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.acquire_clinical_lock(text, int, text) FROM anon, authenticated;;
