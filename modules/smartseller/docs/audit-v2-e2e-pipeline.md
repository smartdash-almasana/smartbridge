# Audit — V2 E2E Pipeline

## Evidencia de componentes (repo)

### Webhook -> Domain (worker)
- Worker: `src/v2/ingest/webhook-to-domain-worker.ts`
  - Lee `v2_webhook_events`: `:64`
  - Filtra no procesados contra `v2_domain_events.source_event_id`: `:77-93`
  - Inserta idempotente con `onConflict: 'source_event_id'`: `:98`
- Endpoint worker HTTP: `src/app/(v2)/api/worker/v2-webhook-to-domain/route.ts`
  - Ruta: `/api/worker/v2-webhook-to-domain`
  - Seguridad `x-cron-secret` + `CRON_SECRET`: `:8-13`, `:28-30`, `:41-43`

### Engine SQL y outputs clínicos
- Función RPC: `supabase/migrations/20260224_v2_engine_rpc.sql:64`
  - Crea `v2_engine_runs`: `:74-76`
  - Lee `v2_domain_events` (join webhook): `:80-83`
  - Inserta señal `events_last_24h`: `:86-93`
  - Inserta `v2_health_scores`: `:98-99`

### Idempotencia persistente
- Índice único de dominio por evento fuente:
  - `supabase/migrations/20260302_v2_domain_events_source_event_unique.sql:6-7`

## Queries exactas de validación (DB)

### 1) Verificar domain_event único por webhook
```sql
select de.source_event_id, count(*) as domain_count
from public.v2_domain_events de
where de.source_event_id = :webhook_event_id::uuid
group by de.source_event_id;
```

### 2) Verificar engine_run
```sql
select run_id, store_id, status, started_at, finished_at
from public.v2_engine_runs
where store_id = :store_id::uuid
order by started_at desc
limit 1;
```

### 3) Verificar señal `events_last_24h` con `count > 0`
```sql
select
  cs.run_id,
  cs.signal_key,
  cs.severity,
  cs.evidence,
  (cs.evidence->>'count')::int as events_count
from public.v2_clinical_signals cs
where cs.store_id = :store_id::uuid
  and cs.signal_key = 'events_last_24h'
order by cs.created_at desc
limit 1;
```

### 4) Verificar health_score
```sql
select hs.run_id, hs.score, hs.computed_at
from public.v2_health_scores hs
where hs.store_id = :store_id::uuid
order by hs.computed_at desc
limit 1;
```

### 5) Verificar no duplicación al correr dos veces
```sql
select count(*) as domain_count
from public.v2_domain_events
where source_event_id = :webhook_event_id::uuid;
```

## Evidencia ejecutada en esta iteración (sin DB real)

Comando:
```bash
npx playwright test tests/v2-webhook-to-domain-worker.spec.ts tests/v2-engine-runner.spec.ts --reporter=line
```

Salida:
```text
Running 3 tests using 2 workers
[1/3] tests\v2-engine-runner.spec.ts ... returns consistent output when RPC returns same payload
[2/3] tests\v2-webhook-to-domain-worker.spec.ts ... is idempotent across reruns for same source_event_id
[3/3] tests\v2-webhook-to-domain-worker.spec.ts ... skips inserts when events are already processed (filtered upstream)
3 passed (33.0s)
```

## Resultados esperados E2E (al ejecutar runbook)
- Worker run 1: `inserted >= 1` (para el webhook nuevo).
- Worker run 2: `inserted = 0` para ese `source_event_id`.
- `v2_domain_events`: exactamente 1 fila por `source_event_id`.
- `v2_engine_runs`: 1 run nuevo con `status='done'`.
- `v2_clinical_signals`: señal `events_last_24h` con `events_count > 0`.
- `v2_health_scores`: 1 score para el run.

## Estado final
**RIESGO**  
(No se ejecutó inserción/worker/engine contra una DB real en esta iteración; queda validación operativa pendiente con el runbook `docs/runbook-v2-e2e.md`.)
