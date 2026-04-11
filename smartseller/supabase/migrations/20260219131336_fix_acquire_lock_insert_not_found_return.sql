-- Fix: the INSERT-path must return true when it successfully creates the row.
-- The existing loop checked FOUND only after the UPDATE, so a fresh INSERT
-- always fell through to the EXISTS check and returned false.

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
  now_ts         timestamptz := now();
  v_locked_until timestamptz := now() + (p_ttl_seconds || ' seconds')::interval;
  v_acquired     boolean;
BEGIN
  LOOP
    -- Case A: Try to insert a new lock row (key does not exist yet)
    INSERT INTO public.job_locks (job_key, locked_until, locked_by, updated_at)
    VALUES (p_job_key, v_locked_until, p_locked_by, now_ts)
    ON CONFLICT (job_key) DO NOTHING;

    IF FOUND THEN
      -- INSERT succeeded → we own the lock
      RETURN true;
    END IF;

    -- Case B: Row already exists. Try UPDATE only if TTL has expired.
    UPDATE public.job_locks
    SET
      locked_until = v_locked_until,
      locked_by    = p_locked_by,
      updated_at   = now_ts
    WHERE job_key     = p_job_key
      AND (locked_until IS NULL OR locked_until < now_ts)
    RETURNING true INTO v_acquired;

    IF FOUND THEN
      -- UPDATE succeeded on expired lock → we own it
      RETURN true;
    END IF;

    -- Case C: Row exists with a live TTL → another worker owns it
    IF EXISTS (
      SELECT 1 FROM public.job_locks
      WHERE job_key    = p_job_key
        AND locked_until > now_ts
    ) THEN
      RETURN false;
    END IF;

    -- Rare concurrent-expiry edge case: loop and retry once
  END LOOP;
END;
$$;

ALTER  FUNCTION public.acquire_clinical_lock(text, int, text) OWNER TO postgres;
REVOKE ALL     ON FUNCTION public.acquire_clinical_lock(text, int, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.acquire_clinical_lock(text, int, text) FROM anon, authenticated;;
