-- Reconcile schema_migrations for V3 worker stack.
-- Run after applying 20260314_v3_* SQL in the target DB.

begin;

insert into public.schema_migrations(version)
values
  ('20260314_v3_webhook_intake_worker'),
  ('20260314_v3_domain_to_snapshot_worker'),
  ('20260314_v3_snapshot_to_metrics_worker'),
  ('20260314_v3_metrics_to_signals_worker'),
  ('20260314_v3_signals_to_health_scores_worker'),
  ('20260314_v3_pipeline_orchestrator_heartbeat')
on conflict (version) do nothing;

commit;
