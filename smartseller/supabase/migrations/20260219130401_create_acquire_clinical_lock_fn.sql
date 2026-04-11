CREATE OR REPLACE FUNCTION public.acquire_clinical_lock(
    p_job_key     text,
    p_ttl_seconds integer DEFAULT 300,
    p_locked_by   text    DEFAULT 'anonymous-worker'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now          timestamptz := now();
    v_locked_until timestamptz;
    v_existing     public.job_locks%ROWTYPE;
BEGIN
    IF p_job_key IS NULL OR trim(p_job_key) = '' THEN
        RAISE EXCEPTION
            'acquire_clinical_lock: p_job_key must not be null or empty'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 THEN
        p_ttl_seconds := 300;
    END IF;

    v_locked_until := v_now + (p_ttl_seconds * INTERVAL '1 second');

    BEGIN
        SELECT *
        INTO v_existing
        FROM public.job_locks
        WHERE job_key = p_job_key
        FOR UPDATE NOWAIT;
    EXCEPTION
        WHEN lock_not_available THEN
            RETURN false;
    END;

    IF NOT FOUND THEN
        INSERT INTO public.job_locks (job_key, locked_by, locked_until, updated_at)
        VALUES (p_job_key, p_locked_by, v_locked_until, v_now)
        ON CONFLICT (job_key) DO NOTHING;

        IF NOT FOUND THEN
            RETURN false;
        END IF;

        RETURN true;
    END IF;

    IF v_existing.locked_until > v_now THEN
        RETURN false;
    END IF;

    UPDATE public.job_locks
    SET
        locked_by    = p_locked_by,
        locked_until = v_locked_until,
        updated_at   = v_now
    WHERE job_key = p_job_key;

    RETURN true;
END;
$$;

ALTER  FUNCTION public.acquire_clinical_lock(text, integer, text) OWNER TO postgres;
REVOKE ALL     ON FUNCTION public.acquire_clinical_lock(text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_clinical_lock(text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.acquire_clinical_lock(text, integer, text) FROM authenticated;;
