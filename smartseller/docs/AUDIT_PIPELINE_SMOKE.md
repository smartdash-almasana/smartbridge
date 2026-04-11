# AUDIT PIPELINE SMOKE

- Fecha/hora: 2026-02-26 13:11:22 -03:00

## Endpoints V2 verificados
- `src/app/(v2)/api/ingest/route.ts` -> `POST`
- `src/app/(v2)/api/normalize/[event_id]/route.ts` -> `POST`
- `src/app/(v2)/api/score/[store_id]/route.ts` -> `GET`

## Tablas verificadas (DB)
- `v2_webhook_events`: count=1, key cols -> `store_id: yes`, `tenant_id: no`, `dedupe_key: no`
- `v2_domain_events`: count=1, key cols -> `store_id: no`, `tenant_id: no`, `dedupe_key: no`
- `v2_clinical_signals`: count=1, key cols -> `store_id: yes`, `tenant_id: no`, `dedupe_key: no`
- `v2_health_scores`: count=1, key cols -> `store_id: yes`, `tenant_id: no`, `dedupe_key: no`
- `v2_snapshots`: schema cache miss (`public.v2_snapshots` no encontrado)
- `v2_metrics`: schema cache miss (`public.v2_metrics` no encontrado)

## Smoke pipeline (sin cambios de código)
- `POST /api/ingest` con payload demo -> `200`, body: `{"ok":true}`
- Event lookup en DB (`v2_webhook_events` por `provider_event_id=/orders/v1/orders/123456`) -> `event_id=d3db2be7-0048-4145-a080-0d451d862c6a`, `store_id=0485e5e6-5bc9-4e85-bdbe-e0c9ff20a0e2`
- `POST /api/normalize/d3db2be7-0048-4145-a080-0d451d862c6a` -> `200`, `domain_event_id=16f87fc4-786b-4275-81de-041ec478525a`
- `GET /api/score/0485e5e6-5bc9-4e85-bdbe-e0c9ff20a0e2` -> `200`, body con `score=0`, `run_id=c410a82c-2129-4f0b-bb26-9492a0f199f4`

## Dashboard dependencia de APIs externas
- Verificado en `src/app/(v2)/dashboard/[store_id]/page.tsx`: usa fetch interno a `/api/me` + redirect; no llama API externa directa.

## Bloqueante principal
- Falta consistencia de naming/estructura de tablas objetivo (`v2_*` activas; `v2_snapshots`/`v2_metrics` no disponibles en schema cache actual).

## Trazabilidad
- `run_id`: `c410a82c-2129-4f0b-bb26-9492a0f199f4`
- `snapshot_id`: `c81ae138-2c2e-4043-8733-181e6d6c1160`
- `v2_health_scores.snapshot_id` (para ese `run_id`): `c81ae138-2c2e-4043-8733-181e6d6c1160`
- `v2_clinical_signals.snapshot_id` (para ese `run_id`): `c81ae138-2c2e-4043-8733-181e6d6c1160`
