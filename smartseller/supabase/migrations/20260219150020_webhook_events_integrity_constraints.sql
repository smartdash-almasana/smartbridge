-- 1️⃣ Status whitelist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webhook_events_status_check'
      AND conrelid = 'public.webhook_events'::regclass
  ) THEN
    ALTER TABLE public.webhook_events
    ADD CONSTRAINT webhook_events_status_check
    CHECK (status IN ('pending','processing','processed','failed','dead_letter'))
    NOT VALID;
  END IF;
END $$;

ALTER TABLE public.webhook_events
VALIDATE CONSTRAINT webhook_events_status_check;

-- 2️⃣ attempts non-negative
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webhook_events_attempts_check'
      AND conrelid = 'public.webhook_events'::regclass
  ) THEN
    ALTER TABLE public.webhook_events
    ADD CONSTRAINT webhook_events_attempts_check
    CHECK (attempts >= 0)
    NOT VALID;
  END IF;
END $$;

ALTER TABLE public.webhook_events
VALIDATE CONSTRAINT webhook_events_attempts_check;

-- 3️⃣ Lock consistency rule
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webhook_events_lock_consistency'
      AND conrelid = 'public.webhook_events'::regclass
  ) THEN
    ALTER TABLE public.webhook_events
    ADD CONSTRAINT webhook_events_lock_consistency
    CHECK (
      (locked_by IS NULL AND locked_at IS NULL)
      OR
      (locked_by IS NOT NULL AND locked_at IS NOT NULL)
    )
    NOT VALID;
  END IF;
END $$;

ALTER TABLE public.webhook_events
VALIDATE CONSTRAINT webhook_events_lock_consistency;;
