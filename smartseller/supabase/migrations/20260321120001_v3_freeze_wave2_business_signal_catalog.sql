BEGIN;

INSERT INTO public.v3_signal_catalog (signal_key, description, is_active)
VALUES
  ('no_sales_7d', 'No paid sales detected in rolling 7-day window with activity guardrails', true),
  ('cancellation_rate_spike', 'Cancellation rate spike in short rolling window', true),
  ('unanswered_questions_24h', 'Open customer questions older than 24h', true),
  ('active_claims_count', 'Active unresolved claims count above threshold', true),
  ('shipment_delay_risk', 'Shipment delay risk from deadline or stale shipment states', true)
ON CONFLICT (signal_key) DO UPDATE
SET description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    updated_at = now();

COMMIT;
