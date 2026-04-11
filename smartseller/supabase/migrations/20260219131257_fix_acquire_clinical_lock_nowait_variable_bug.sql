-- FIX: nuevadb.sql version clobbers now_ts (timestamptz) by reusing it as
-- the RETURNING boolean target, which causes locked_until/updated_at = NULL
-- on the INSERT path.
-- Resolution: introduce v_locked_until and v_acquired to separate concerns.
-- The external contract (signature, security posture) is unchanged.

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
  now_ts        timestamptz := now();
  v_locked_until timestamptz := now() + (p_ttl_seconds || ' seconds')::interval;
  v_acquired    boolean;
BEGIN
  LOOP
    -- Attempt INSERT for a brand-new key
    INSERT INTO public.job_locks (job_key, locked_until, locked_by, updated_at)
    VALUES (p_job_key, v_locked_until, p_locked_by, now_ts)
    ON CONFLICT (job_key) DO NOTHING;

    -- Attempt to claim an existing row that is unlocked or expired
    UPDATE public.job_locks
    SET
      locked_until = v_locked_until,
      locked_by    = p_locked_by,
      updated_at   = now_ts
    WHERE job_key     = p_job_key
      AND (locked_until IS NULL OR locked_until < now_ts)
    RETURNING true INTO v_acquired;

    IF FOUND THEN
      RETURN true;
    END IF;

    -- Check if another worker currently holds a live lock
    IF EXISTS (
      SELECT 1 FROM public.job_locks
      WHERE job_key    = p_job_key
        AND locked_until > now_ts
    ) THEN
      RETURN false;
    END IF;

    -- Concurrent expiry edge-case: retry the loop once
  END LOOP;
END;
$$;

ALTER  FUNCTION public.acquire_clinical_lock(text, int, text) OWNER TO postgres;
REVOKE ALL     ON FUNCTION public.acquire_clinical_lock(text, int, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.acquire_clinical_lock(text, int, text) FROM anon, authenticated;;
