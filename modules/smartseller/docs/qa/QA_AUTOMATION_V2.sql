-- SmartSeller V2.1 - QA automation checks (read-only)
-- Output columns: check_key, status, detail, observed_at

WITH
  dup_domain AS (
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT source_event_id
      FROM public.v2_domain_events
      GROUP BY source_event_id
      HAVING COUNT(*) > 1
    ) d
  ),
  zombie_runs AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_engine_runs
    WHERE status = 'running'
      AND started_at < now() - interval '10 minutes'
  ),
  invalid_status AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_engine_runs
    WHERE status NOT IN ('running', 'done', 'failed')
  ),
  recent_scores AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_health_scores
    WHERE computed_at >= now() - interval '24 hours'
  ),
  recent_signals AS (
    SELECT COUNT(*)::int AS n
    FROM public.v2_clinical_signals
    WHERE created_at >= now() - interval '24 hours'
  )
SELECT
  'A.idempotencia_domain_events'::text AS check_key,
  CASE WHEN d.n = 0 THEN 'PASS' ELSE 'FAIL' END::text AS status,
  ('duplicate_source_event_ids=' || d.n)::text AS detail,
  now() AS observed_at
FROM dup_domain d

UNION ALL

SELECT
  'B.no_engine_runs_zombies'::text AS check_key,
  CASE WHEN z.n = 0 THEN 'PASS' ELSE 'FAIL' END::text AS status,
  ('running_older_than_10m=' || z.n)::text AS detail,
  now() AS observed_at
FROM zombie_runs z

UNION ALL

SELECT
  'C.engine_run_status_validos'::text AS check_key,
  CASE WHEN s.n = 0 THEN 'PASS' ELSE 'FAIL' END::text AS status,
  ('invalid_status_rows=' || s.n)::text AS detail,
  now() AS observed_at
FROM invalid_status s

UNION ALL

SELECT
  'D.health_scores_recientes_24h'::text AS check_key,
  CASE WHEN hs.n >= 1 THEN 'PASS' ELSE 'FAIL' END::text AS status,
  ('health_scores_last_24h=' || hs.n)::text AS detail,
  now() AS observed_at
FROM recent_scores hs

UNION ALL

SELECT
  'E.clinical_signals_recientes_24h'::text AS check_key,
  CASE WHEN cs.n >= 1 THEN 'PASS' ELSE 'FAIL' END::text AS status,
  ('clinical_signals_last_24h=' || cs.n)::text AS detail,
  now() AS observed_at
FROM recent_signals cs

ORDER BY check_key;
