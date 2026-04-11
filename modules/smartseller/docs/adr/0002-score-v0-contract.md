# ADR-0002: Score V0 determinista desde DB (domain_events -> metrics -> signals -> score)

- Status: Accepted
- Date: 2026-02-26 -03:00

## Context
- SmartSeller es sistema clinico de riesgo operativo (no analytics).
- El score debe ser reproducible sin APIs externas.
- Identidad multi-tenant: `tenant_id`, `store_id`, `seller_uuid`, `external_account_id`, `provider_key`.
- Trazabilidad obligatoria: `snapshot_id -> clinical_signals -> health_scores -> run_id`.

## Decision
- Event types soportados V0: `order.created`, `order.cancelled`, `message.received`, `message.answered`, `claim.opened` (ignore others).
- Metricas diarias en `v2_metrics_daily.metrics` (`jsonb`) con 5 keys 1d:
  - `orders_created_1d`
  - `orders_cancelled_1d`
  - `messages_received_1d`
  - `messages_answered_1d`
  - `claims_opened_1d`
- Senales V0 (5) con penalidades `40/25/20/10/5`.
- Score: `clamp(100 - sum(penalidades_activas), 0..100)`.
- Recompute gate: si `computed_at >= now()-1h` se retorna ultimo score; si no, se recalcula.
- Persistencia obligatoria: `v2_snapshots` + `v2_health_scores` + `v2_clinical_signals` con `run_id` y `snapshot_id`.

## Consequences
- Pros:
  - Determinismo offline.
  - Auditable.
  - Replayable desde DB.
- Cons:
  - Dependencia de ventanas temporales (`now`).
  - Bootstrap de `metrics_daily` para performance.
- Mitigations:
  - `v2_snapshots.payload` conserva evidence y breakdown.
  - Reconciliacion/backfill fuera del scoring.

## Evidence
- Ejemplo real auditado (persistido):
  - `store_id=0485e5e6-5bc9-4e85-bdbe-e0c9ff20a0e2`
  - `score=0`
  - `computed_at`: ver `v2_health_scores.computed_at` del `run_id` siguiente
  - `run_id=c410a82c-2129-4f0b-bb26-9492a0f199f4`
  - `snapshot_id=c81ae138-2c2e-4043-8733-181e6d6c1160`
- Queries de verificacion:
  - `v2_health_scores`
  - `v2_snapshots`
  - `v2_clinical_signals`
  - `v2_metrics_daily`

## References
- Commits:
  - `9aaf1e8`
  - `b4787c3`
  - `042794e`
  - `3331c91`
  - `a34ceb2`
- `docs/AUDIT_PIPELINE_SMOKE.md`
- `src/v2/api/score.ts`
- `docs/V2_SCORE_V0_CONTRACT.md`
