-- ─────────────────────────────────────────────────────────────────────────────
-- QA Automation: Token Refresh Worker
-- Archivo: docs/qa/QA_AUTOMATION_TOKEN_REFRESH.sql
-- Ejecutar como SELECT-only contra prod Supabase.
-- Devuelve PASS/FAIL por cada invariant.
--
-- Ventanas explícitas (alineadas con worker route.ts):
--   REFRESH_WINDOW   = 30 min  (tokens a encolar)
--   BACKOFF_MIN      = 60 s    (base exponencial)
--   BACKOFF_CAP      = 30 min  (techo)
--   DLQ_THRESHOLD    = 10 intentos
--   CRON_INTERVAL    = 10 min  (pg_cron schedule)
--   BACKLOG_GRACE    = 15 min  (margen acceptable sobre CRON_INTERVAL)
--   STALENESS_GRACE  = 15 min  (ventana transitoria: token puede estar vencido
--                               hasta que el worker siguiente lo refresque)
--   METRICS_WINDOW   = 5 min   (ventana de observabilidad)
--   HEARTBEAT_WINDOW = 15 min  (ventana de heartbeat = 1.5x CRON_INTERVAL)
-- ─────────────────────────────────────────────────────────────────────────────

WITH
  -- 1) Tokens expirando en 30m sin cobertura real.
  --    Cobertura real = job en estado 'running' (ya reclamado)
  --                   O job 'pending' elegible (next_eligible_at <= now())
  --    NOTA: 'failed' en backoff futuro NO cubre — el token quedará sin refresh
  --    hasta que el backoff venza. Solo se considera cubierto si next_eligible_at <= now().
  tokens_expiring_unattended AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_oauth_tokens t
    WHERE t.expires_at < now() + interval '30 minutes'
      AND t.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM public.token_refresh_jobs j
        WHERE j.store_id = t.store_id
          AND (
            -- already claimed and running
            j.status = 'running'
            OR
            -- pending/failed AND eligible right now (not in backoff future)
            (j.status IN ('pending', 'failed') AND j.next_eligible_at <= now())
          )
      )
  ),

  -- 2) Jobs con backlog viejo sin procesar (ventana explícita: 15 min)
  --    Detecta jobs cuyo tiempo de elegibilidad ya pasó hace > 15 min
  --    y ningún worker los ha reclamado. Indica cron muerto o claim fallando.
  backlog_old AS (
    SELECT COUNT(*)::int AS n
    FROM public.token_refresh_jobs
    WHERE status IN ('pending', 'failed')
      AND next_eligible_at <= now() - interval '15 minutes'
  ),

  -- 3) DLQ invariant: attempts >= 10 que NO son dead_letter (0 violaciones)
  --    El worker setea dead_letter cuando nextAttempts >= 10 (DLQ_THRESHOLD).
  dlq_invariant_violations AS (
    SELECT COUNT(*)::int AS n
    FROM public.token_refresh_jobs
    WHERE attempts >= 10
      AND status != 'dead_letter'
  ),

  -- 4) Concurrencia: mismo store_id con status='running' más de una vez.
  --    Imposible por PK (store_id es PK), pero check defensivo igual.
  concurrency_locks_dup AS (
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT store_id
      FROM public.token_refresh_jobs
      WHERE status = 'running'
      GROUP BY store_id
      HAVING COUNT(*) > 1
    ) sub
  ),

  -- 5) Staleness: tokens 'active' vencidos hace > 15 min (ventana transitoria).
  --    Un token puede estar vencido durante hasta ~10 min (gap entre corridas de cron).
  --    La ventana de gracia de 15 min evita FAILs espurios en operación normal.
  --    meli-token.ts marca status='invalid' solo ante invalid_grant/401 de ML.
  --    Si expires_at < now() - 15m y status='active' => worker no corrió o claim atascado.
  staleness_expired AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_oauth_tokens
    WHERE expires_at < now() - interval '15 minutes'
      AND status = 'active'
  ),

  -- 6a) Métricas recientes: al menos 1 row de token-refresh en los últimos 5 min
  metrics_recent AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_runtime_metrics_minute
    WHERE worker_name = 'token-refresh'
      AND bucket_minute >= now() - interval '5 minutes'
  ),

  -- 6b) Heartbeat reciente: al menos 1 instancia del worker activa en 15 min.
  --     Ventana = 1.5x el intervalo del cron (10 min).
  --     Si no hay heartbeat en 15 min el worker dejó de correr.
  heartbeat_recent AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_worker_heartbeats
    WHERE worker_name = 'token-refresh'
      AND last_seen_at >= now() - interval '15 minutes'
  )

SELECT
  '1.tokens_expiring_unattended' AS "check",
  CASE WHEN t.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('unattended_expiring=' || t.n)::text AS detail
FROM tokens_expiring_unattended t

UNION ALL

SELECT
  '2.backlog_old_jobs' AS "check",
  CASE WHEN b.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('old_pending_failed_gt15m=' || b.n)::text AS detail
FROM backlog_old b

UNION ALL

SELECT
  '3.dlq_invariant' AS "check",
  CASE WHEN d.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('attempts_ge10_not_dlq=' || d.n)::text AS detail
FROM dlq_invariant_violations d

UNION ALL

SELECT
  '4.concurrency_locks_duplicate' AS "check",
  CASE WHEN c.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('stores_with_multiple_running=' || c.n)::text AS detail
FROM concurrency_locks_dup c

UNION ALL

SELECT
  '5.staleness_expired_tokens_gt15m' AS "check",
  CASE WHEN s.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('active_tokens_expired_gt15m=' || s.n)::text AS detail
FROM staleness_expired s

UNION ALL

SELECT
  '6a.metrics_recent_5m' AS "check",
  CASE WHEN m.n >= 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('metrics_rows_last_5m=' || m.n)::text AS detail
FROM metrics_recent m

UNION ALL

SELECT
  '6b.heartbeat_recent_15m' AS "check",
  CASE WHEN h.n >= 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  ('heartbeat_instances_last_15m=' || h.n)::text AS detail
FROM heartbeat_recent h

ORDER BY "check";
