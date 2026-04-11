# SmartSeller V3 — Pipeline End-to-End READY

> Última actualización: 2026-03-14

## Estado actual

SmartSeller V3 tiene operativo el pipeline clínico canónico de punta a punta, con ejecución secuencial, idempotencia por etapa y capa operativa mínima ya implementada.

Estado general: **READY**

Alcance activo en esta etapa:

- `v3_webhook_events -> v3_domain_events` READY
- `v3_domain_events -> v3_snapshots` READY
- `v3_snapshots -> v3_metrics_daily` READY
- `v3_metrics_daily -> v3_clinical_signals` READY
- `v3_clinical_signals -> v3_health_scores` READY
- orquestador V3 end-to-end READY
- heartbeat y diagnóstico operativo READY

Fuera de alcance en esta etapa:

- Shopify
- evolución funcional de V2
- cambios de ADR

## Pipeline operativo

El pipeline V3 corre por workers secuenciales gobernados:

1. `webhook-to-domain`
2. `domain-to-snapshot`
3. `snapshot-to-metrics`
4. `metrics-to-signals`
5. `signals-to-health-score`
6. `pipeline/run` como orquestador end-to-end

Cada tramo mantiene:

- claim concurrente seguro
- lease recovery para jobs atascados en `processing`
- dedupe e idempotencia por clave canónica
- re-run seguro sin duplicación estructural

## Estado operativo mínimo

La capa operativa mínima de V3 ya está disponible:

- endpoint orquestador: `/api/v3/worker/pipeline/run`
- respuesta por etapa con `claimed`, `processed`, `failed`
- cierre de `v3_engine_runs` a `done` cuando el score ya fue materializado
- marcado mínimo de `v3_engine_runs.failed` cuando la ejecución detecta errores downstream sobre runs aún `running`
- heartbeat persistente en `v3_worker_heartbeats`
- diagnóstico por etapa con tiempos (`duration_ms`) y estado `ok/failed`

## Posicionamiento de plataforma

V2 no es la base futura de SmartSeller.

V2 permanece como baseline heredada y referencia histórica/operativa, pero la base objetivo para evolución clínica, tenancy y operación canónica es V3.

La etapa actual continúa enfocada en Mercado Libre. Shopify sigue explícitamente fuera de alcance.

## Superficies read-only sobre V3 (cerradas)

**Disciplina operativa vigente:** `docs/architecture/V3_READ_MODEL_PATTERN.md`

### Primera — Read Model Clínico

**Fecha de cierre:** 2026-03-14 | **Dictamen:** `APPROVED WITH MINOR NOTES`

- Endpoint: `GET /api/v3/clinical-status?tenant_id=<uuid>&store_id=<uuid>`
- Estado clínico actual del store: score, severity_band, señales activas, freshness, evidencia mínima.
- Consume exclusivamente estado persistido V3. Guard `x-cron-secret`. Build OK.
- Nota menor remanente: auth escalada pendiente para exposición pública.

### Segunda — Historial de Runs

**Fecha de cierre:** 2026-03-14 | **Dictamen:** `APPROVED WITH MINOR FIXES` (fixes aplicados)

- Endpoint: `GET /api/v3/run-history?tenant_id=<uuid>&store_id=<uuid>&limit=<n>`
- Últimos N runs (default 10, máx 50): score, señales resumidas y snapshot_id por run.
- Orden `started_at DESC`. Respuestas parciales (score null, signals vacíos) explícitas.
- Fix aplicado: error tipado `V3RunHistoryStoreNotFoundError` para derivar 404 correctamente.

### Tercera — Store Pulse (composición)

**Fecha de cierre:** 2026-03-14 | **Dictamen:** `APPROVED WITH MINOR FIXES` (fixes aplicados)

- Endpoint: `GET /api/v3/store-pulse?tenant_id=<uuid>&store_id=<uuid>`
- Estado actual (`current`) + últimos 5 runs resumidos (`recent_runs`) en una sola respuesta.
- Compone `readV3ClinicalStatus` + `readV3RunHistory` directamente — sin fetch HTTP interno.
- Fix aplicado: `V3ClinicalStatusStoreNotFoundError` exportada y evaluada por `instanceof` en el route.

---

## Deudas menores pendientes

Pendientes reales y acotados:

- `stale running timeout` global para `v3_engine_runs`
- historial persistente por invocación del orquestador, separado del heartbeat por instancia
- estabilidad de `computed_at` en reruns idempotentes cuando el contenido no cambia
- auth escalada para el endpoint clínico (más allá de `x-cron-secret`)

## Referencias

- `src/app/api/v3/worker/pipeline/run/route.ts`
- `src/app/api/v3/clinical-status/route.ts`
- `src/v3/engine/pipeline-orchestrator.ts`
- `src/v3/ingest/webhook-to-domain-worker.ts`
- `src/v3/engine/domain-to-snapshot-worker.ts`
- `src/v3/engine/snapshot-to-metrics-worker.ts`
- `src/v3/engine/metrics-to-signals-worker.ts`
- `src/v3/engine/signals-to-health-score-worker.ts`
