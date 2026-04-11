-- SmartSeller V3 — Pipeline orchestrator heartbeat
-- Scope:
--   1) Persist execution heartbeat/status per orchestrator instance
--   2) Keep minimal operational metadata for troubleshooting

BEGIN;

CREATE TABLE IF NOT EXISTS public.v3_worker_heartbeats (
  worker_name     text NOT NULL,
  worker_instance text NOT NULL,
  status          text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (worker_name, worker_instance)
);

CREATE INDEX IF NOT EXISTS idx_v3_worker_heartbeats_name_seen
  ON public.v3_worker_heartbeats (worker_name, last_seen_at DESC);

COMMIT;
