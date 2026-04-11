# Runbook — V2 E2E Pipeline (Webhook -> Domain -> Engine)

## Scope
Validar de punta a punta, sin intervención manual de UI:
1. Ingesta en `v2_webhook_events`
2. Conversión por worker a `v2_domain_events`
3. Ejecución de `public.v2_run_engine_for_store(store_id)`
4. Verificación de `v2_engine_runs`, `v2_clinical_signals`, `v2_health_scores`
5. Re-ejecución sin duplicar `v2_domain_events`

## Confirmación en repo (tablas y función)

- `v2_webhook_events`: `supabase/migrations/20260302_v2_webhook_events.sql:9`
- `v2_domain_events`: usada en worker y engine:
  - `src/v2/ingest/webhook-to-domain-worker.ts:78`
  - `supabase/migrations/20260224_v2_engine_rpc.sql:80`
- `v2_engine_runs`: `supabase/migrations/20260224_v2_engine_rpc.sql:13`
- `v2_clinical_signals`: `supabase/migrations/20260224_v2_engine_rpc.sql:30`
- `v2_health_scores`: `supabase/migrations/20260224_v2_engine_rpc.sql:50`
- función `public.v2_run_engine_for_store(store_id)`:
  - `supabase/migrations/20260224_v2_engine_rpc.sql:64`

## Prerrequisitos
- Tener un `store_id` válido existente en `v2_stores`.
- Tener `CRON_SECRET` disponible para invocar el worker HTTP.
- Aplicar migraciones pendientes (incluyendo:
  - `20260302_v2_webhook_events.sql`
  - `20260302_v2_domain_events_source_event_unique.sql`).

Variables sugeridas:

```bash
export BASE_URL="https://smartsellerv2.vercel.app"
export CRON_SECRET="<tu_cron_secret>"
export STORE_ID="<uuid_store>"
export PROVIDER_EVENT_ID="manual:e2e:orders:123"
```

## Paso 1 — Insertar 1 webhook fake en `v2_webhook_events`

SQL:

```sql
insert into public.v2_webhook_events (
  store_id,
  provider_event_id,
  topic,
  resource,
  provider_user_id,
  raw_payload,
  received_at
)
values (
  :store_id,
  :provider_event_id,
  'orders_v2',
  '/orders/123',
  'e2e-user',
  jsonb_build_object(
    'topic', 'orders_v2',
    'resource', '/orders/123',
    'kind', 'e2e'
  ),
  now()
)
returning event_id, store_id, provider_event_id, received_at;
```

Guardar `event_id` retornado como `:webhook_event_id`.

## Paso 2 — Ejecutar worker HTTP

```bash
curl -i \
  -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/worker/v2-webhook-to-domain?limit=50"
```

Esperado: HTTP `200` con JSON:

```json
{ "scanned": 1, "inserted": 1, "deduped": 0 }
```

## Paso 3 — Ejecutar engine

SQL:

```sql
select public.v2_run_engine_for_store(:store_id::uuid) as result;
```

Esperado: JSON con `run_id`, `score`, `signals`.

## Paso 4 — Verificaciones SQL exactas

### 4.1 Domain event único por source_event_id

```sql
select
  de.source_event_id,
  count(*) as domain_count
from public.v2_domain_events de
where de.source_event_id = :webhook_event_id::uuid
group by de.source_event_id;
```

Esperado: `domain_count = 1`.

### 4.2 Engine run creado

```sql
select
  run_id,
  store_id,
  status,
  started_at,
  finished_at
from public.v2_engine_runs
where store_id = :store_id::uuid
order by started_at desc
limit 1;
```

Esperado: 1 fila, `status = 'done'`.

### 4.3 Señal `events_last_24h` con `count > 0`

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

Esperado: 1 fila y `events_count > 0`.

### 4.4 Health score creado

```sql
select
  hs.run_id,
  hs.score,
  hs.computed_at
from public.v2_health_scores hs
where hs.store_id = :store_id::uuid
order by hs.computed_at desc
limit 1;
```

Esperado: 1 fila.

## Paso 5 — Re-ejecutar para validar no duplicación

### 5.1 Correr worker nuevamente

```bash
curl -i \
  -H "x-cron-secret: $CRON_SECRET" \
  "$BASE_URL/api/worker/v2-webhook-to-domain?limit=50"
```

Esperado: `inserted = 0` para ese evento ya procesado.

### 5.2 Verificar que no se duplicó domain_event

```sql
select
  count(*) as domain_count
from public.v2_domain_events
where source_event_id = :webhook_event_id::uuid;
```

Esperado: `domain_count = 1`.

## Prueba automática mínima (sin DB real)

Comando:

```bash
npx playwright test tests/v2-webhook-to-domain-worker.spec.ts tests/v2-engine-runner.spec.ts --reporter=line
```

Cobertura:
- Worker idempotente en re-ejecución (`source_event_id` no duplica).
- Worker sin inserciones cuando carga 0 eventos no procesados.
- Runner de engine consistente cuando RPC retorna payload estable.
