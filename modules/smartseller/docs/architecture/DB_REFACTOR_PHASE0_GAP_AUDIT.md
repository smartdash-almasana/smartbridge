# DB Refactor — Phase 0 Gap Audit

**Fecha:** 2026-03-03  
**Fuentes:** Supabase MCP (lectura real) + `supabase/migrations/` + `docs/architecture/`  
**Contrato de referencia:** `docs/architecture/V1_CORE_ENTITIES_SPEC.md`

---

## A) Inventario de Migraciones en Repo

| # | Archivo | Propósito | Crea/Alter v2_* |
|---|---------|-----------|-----------------|
| 1 | `20260224_v2_auth.sql` | v2_oauth_states, v2_oauth_tokens, v2_store_memberships; RLS en stores/signals/scores | ALTERA v2_stores (display_name) |
| 2 | `20260224_v2_engine_rpc.sql` | CREATE v2_engine_runs, v2_clinical_signals, v2_health_scores; RPC v2_run_engine_for_store | CREA v2_engine_runs, v2_clinical_signals, v2_health_scores |
| 3 | `20260224_v2_engine_schema_fix.sql` | DROP+RECREATE de v2_health_scores, v2_clinical_signals, v2_engine_runs | RECREA las 3 tablas del engine |
| 4 | `20260226_v2_link_snapshot_to_outputs.sql` | ADD COLUMN snapshot_id a health_scores/signals; índices store+run | ALTERA v2_health_scores, v2_clinical_signals |
| 5 | `20260302_v2_domain_events_source_event_unique.sql` | UNIQUE INDEX en v2_domain_events.source_event_id | SOLO índice |
| 6 | `20260302_v2_webhook_events.sql` | CREATE v2_webhook_events | CREA v2_webhook_events |
| 7 | `20260303_token_refresh.sql` | CREATE token_refresh_jobs, v2_worker_heartbeats, v2_runtime_metrics_minute; RPC v2_claim_token_refresh_jobs | CREA 3 tablas observabilidad |
| 8 | `20260303_webhook_events_dedupe_claim_index.sql` | Índices dedupe/claim en webhook_events | SOLO índices |

**⚠️ DRIFT CRÍTICO — Tablas en DB real SIN CREATE TABLE en repo:**

| Tabla | En DB Real | En Repo |
|-------|-----------|---------|
| `v2_tenants` | ✅ | ❌ MISSING |
| `v2_sellers` | ✅ | ❌ MISSING |
| `v2_stores` | ✅ | ❌ MISSING (solo alteraciones) |
| `v2_domain_events` | ✅ | ❌ MISSING (solo índice aditivo) |
| `v2_snapshots` | ✅ | ❌ MISSING |
| `v2_state_snapshots` | ✅ | ❌ MISSING |
| `v2_metrics_daily` | ✅ | ❌ MISSING |

**Conclusión Drift:** El repo NO puede reconstruir la DB desde cero. 6 tablas core existen solo en producción.

---

## B) Inventario Real de Schema (Supabase MCP)

### v2_tenants
| Columna | Tipo | Nullable | Constraint |
|---------|------|----------|------------|
| tenant_id | uuid | NOT NULL | PK |
| name | text | NOT NULL | — |
| created_at | timestamptz | NOT NULL | default now() |
| updated_at | timestamptz | NOT NULL | default now() |

Triggers: ❌ ninguno en v2_tenants.

### v2_sellers
| Columna | Tipo | Nullable | Constraint |
|---------|------|----------|------------|
| seller_uuid | uuid | NOT NULL | PK |
| tenant_id | uuid | NOT NULL | FK → v2_tenants |
| display_name | text | NULL | — |
| created_at | timestamptz | NOT NULL | — |
| updated_at | timestamptz | NOT NULL | — |

Triggers: ❌ ninguno en v2_sellers V2 (el trigger `trg_sellers_set_updated_at` es de la tabla `sellers` V0).

### v2_stores
| Columna | Tipo | Nullable | Constraint |
|---------|------|----------|------------|
| store_id | uuid | NOT NULL | PK |
| tenant_id | uuid | NOT NULL | FK → v2_tenants |
| seller_uuid | uuid | NOT NULL | FK → v2_sellers |
| provider_key | text | NOT NULL | CHECK IN ('mercadolibre','shopify') |
| external_account_id | text | NOT NULL | — |
| connection_status | text | NOT NULL | CHECK IN ('connected','disconnected','uninstalled') |
| market | text | NULL | — |
| created_at | timestamptz | NOT NULL | — |
| updated_at | timestamptz | NOT NULL | — |
| display_name | text | NULL | — |

UNIQUE: `(tenant_id, provider_key, external_account_id)` ✅  
Triggers: ❌ ninguno. `updated_at` existe pero no tiene trigger.

### v2_webhook_events (en repo: 20260302_v2_webhook_events.sql:9)
| Columna | Tipo | Nullable | Constraint |
|---------|------|----------|------------|
| event_id | uuid | NOT NULL | PK |
| store_id | uuid | NOT NULL | FK → v2_stores |
| provider_event_id | text | NOT NULL | — |
| topic | text | NOT NULL | — |
| resource | text | NULL | — |
| provider_user_id | text | NULL | — |
| raw_payload | jsonb | NULL | — |
| received_at | timestamptz | NOT NULL | default now() |
| **tenant_id** | uuid | **NULL** | ❌ nullable |
| dedupe_key | text | NULL | — |

UNIQUE: `(store_id, provider_event_id)` ✅ ; `(store_id, dedupe_key) WHERE dedupe_key IS NOT NULL` ✅  
FK: `store_id → v2_stores` ✅ — garantía cross-tenant  
**tenant_id NULLABLE**: riesgo de eventos sin tenant.

### v2_domain_events
| Columna | Tipo | Nullable | Constraint |
|---------|------|----------|------------|
| domain_event_id | uuid | NOT NULL | PK |
| source_event_id | uuid | NOT NULL | UNIQUE, FK → v2_webhook_events.event_id |
| event_type | text | NOT NULL | — |
| entity_type | text | NOT NULL | — |
| entity_id | text | NOT NULL | — |
| payload | jsonb | NULL | — |
| occurred_at | timestamptz | **NULL** | ❌ |
| normalized_at | timestamptz | NOT NULL | default now() |
| **tenant_id** | uuid | **NULL** | ❌ BLOCKER |
| **store_id** | uuid | **NULL** | ❌ BLOCKER |

UNIQUE: `source_event_id` ✅ (idempotencia garantizada por DB)  
FK: `source_event_id → v2_webhook_events.event_id` — esto es el tie-breaker indirecto: los domain events solo pueden existir para webhook_events que tienen `store_id NOT NULL`. Sin embargo `store_id`/`tenant_id` en domain_events mismo son NULL.  
Índice: `store_id WHERE store_id IS NOT NULL` — confirma que NULLs son esperados por quien diseñó el índice (problema).  
**`normalized_at` NOT NULL**: sirve como tie-breaker monotónico secundario ✅

### v2_snapshots
| Columna | Tipo | Nullable | Constraint |
|---------|------|----------|------------|
| snapshot_id | uuid | NOT NULL | PK |
| **tenant_id** | uuid | **NULL** | ❌ BLOCKER |
| **store_id** | uuid | **NULL** | ❌ BLOCKER |
| **snapshot_at** | timestamptz | **NULL** | ❌ REQUIRED |
| payload | jsonb | NOT NULL | — |
| run_id | uuid | NULL | — (no FK definida) |

No hay FK de `store_id → v2_stores`. No hay UNIQUE. No hay trigger.

### v2_metrics_daily
| Columna | Tipo | Nullable | Constraint |
|---------|------|----------|------------|
| tenant_id | uuid | NOT NULL | PK (compuesta) |
| store_id | uuid | NOT NULL | PK (compuesta) |
| metric_date | date | NOT NULL | PK (compuesta) |
| metrics | jsonb | NOT NULL | default '{}' |

✅ Identidad correcta. Sin FK a stores (gap menor).

### v2_engine_runs (en repo: 20260224_v2_engine_rpc.sql:13)
| Columna | Tipo | Nullable |
|---------|------|----------|
| run_id | uuid | NOT NULL PK |
| store_id | uuid | NOT NULL FK→v2_stores |
| status | text | NOT NULL CHECK('running','done','failed') |
| started_at | timestamptz | NOT NULL |
| finished_at | timestamptz | NULL |

✅ Robusto. Sin tenant_id (aceptable: derivable via store).

### v2_health_scores / v2_clinical_signals
Ambas: `store_id NOT NULL`, `run_id NOT NULL`, FK a v2_stores y v2_engine_runs ✅.  
`tenant_id` NULL en ambas — no bloqueante (derivable via store_id → tenant_id).  
UNIQUE en health_scores: `(store_id, run_id)` ✅

### Tablas core tipadas (v2_orders, v2_payments, v2_fulfillments, v2_refunds, v2_order_items)
**Resultado Supabase MCP:** ❌ NINGUNA EXISTE en schema public.  
El contrato `V1_CORE_ENTITIES_SPEC.md` las documenta. No están implementadas.

### Triggers
Query ejecutada:
```sql
SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public';
```
**Resultado:** 1 fila: `trg_sellers_set_updated_at` sobre tabla `sellers` (V0).  
**Ninguna tabla V2 tiene trigger `updated_at`.**

---

## C) GAP REPORT

### BLOCKER — Rompen invariantes del contrato

| ID | Tabla | Columna | Estado actual | Esperado | Invariante violada |
|----|-------|---------|--------------|----------|-------------------|
| B1 | `v2_domain_events` | `store_id` | NULLABLE | NOT NULL | Multi-tenant: score sin dueño |
| B2 | `v2_domain_events` | `tenant_id` | NULLABLE | NOT NULL | Multi-tenant: evento huérfano |
| B3 | `v2_domain_events` | `occurred_at` | NULLABLE | NOT NULL | Timeline reproducible imposible |
| B4 | `v2_snapshots` | `store_id` | NULLABLE | NOT NULL | Score irreproducible |
| B5 | `v2_snapshots` | `tenant_id` | NULLABLE | NOT NULL | Aislación cruzada rota |
| B6 | 6 tablas core + repo | N/A | Sin DDL en repo | CREATE en migrations | Repo no reconstruye DB |
| B7 | `v2_orders`, `v2_payments`, `v2_fulfillments`, `v2_refunds` | N/A | No existen | Existen según contrato | Determinismo clínico por JSONB |

**Evidencia B1–B5:**
```sql
-- B1-B3 confirmados:
-- v2_domain_events: tenant_id IS NULLABLE, store_id IS NULLABLE, occurred_at IS NULLABLE
-- Evidencia: information_schema.columns WHERE table_name='v2_domain_events'

-- Dato adicional: 5 registros huérfanos (store_id NULL) ya existen en producción
-- (detectados por QA_AUTOMATION_SYSTEM.sql check 1: orphan_count=5)
```

**Evidencia B6:**
```
-- find_by_name: solo 8 archivos en supabase/migrations/
-- No existe CREATE TABLE para v2_tenants, v2_sellers, v2_stores, v2_domain_events, v2_snapshots, v2_metrics_daily
```

**Remediación DDL B1–B5 (no aplicar aún — ver Plan):**
```sql
-- Limpiar huérfanos primero (5 filas detectadas)
DELETE FROM public.v2_domain_events WHERE store_id IS NULL OR tenant_id IS NULL;
DELETE FROM public.v2_snapshots WHERE store_id IS NULL OR tenant_id IS NULL;
-- Luego endurecer
ALTER TABLE public.v2_domain_events ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.v2_domain_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.v2_domain_events ALTER COLUMN occurred_at SET NOT NULL;
ALTER TABLE public.v2_snapshots ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.v2_snapshots ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.v2_snapshots ALTER COLUMN snapshot_at SET NOT NULL;
```

### REQUIRED — Necesario antes de cutover de workers

| ID | Descripción | Impacto |
|----|-------------|---------|
| R1 | Triggers `updated_at` en `v2_stores`, `v2_domain_events`, `v2_snapshots` | Drift detectable |
| R2 | FK `v2_snapshots.store_id → v2_stores.store_id` | Cross-tenant leak posible |
| R3 | FK `v2_webhook_events.tenant_id` → `v2_tenants` o hacerla NOT NULL | Simetría identidad |
| R4 | Baseline migration (dump DDL real) en repo | Reproducibilidad |

**Remediación R1 (DDL exacto):**
```sql
CREATE OR REPLACE FUNCTION public.v2_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_v2_stores_updated_at
  BEFORE UPDATE ON public.v2_stores
  FOR EACH ROW EXECUTE FUNCTION public.v2_set_updated_at();

CREATE TRIGGER trg_v2_domain_events_updated_at
  BEFORE UPDATE ON public.v2_domain_events
  FOR EACH ROW EXECUTE FUNCTION public.v2_set_updated_at();
-- Nota: v2_domain_events actualmente no tiene columna updated_at.
-- Agregar la columna primero:
ALTER TABLE public.v2_domain_events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TRIGGER trg_v2_snapshots_updated_at
  BEFORE UPDATE ON public.v2_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.v2_set_updated_at();
-- Nota: v2_snapshots actualmente no tiene columna updated_at.
ALTER TABLE public.v2_snapshots ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
```

### NICE — Post-cutover

| ID | Descripción |
|----|-------------|
| N1 | CHECK `v2_webhook_events.topic IN (...)` |
| N2 | Índice compuesto `v2_domain_events (store_id, occurred_at DESC)` — ahora el índice solo cubre `occurred_at DESC` |
| N3 | Scaffolding tablas core tipadas (v2_orders, v2_payments, etc.) según V1_CORE_ENTITIES_SPEC.md |

---

## D) Plan de Ejecución — Phase 1 Apply (orden estricto)

**Pre-requisito:** App workers deben enviar `store_id` y `tenant_id` en cada insert a `v2_domain_events` y `v2_snapshots`. Verificar antes de aplicar B1–B5.

### Paso 1 — Baseline Reconstruction (sin riesgo)
```
Nombre: 20260303_05_v2_baseline_missing_tables.sql
Contenido: dump de CREATE TABLE IF NOT EXISTS para las 6 tablas no documentadas.
Riesgo: NULO (IF NOT EXISTS, no modifica nada en prod).
```

### Paso 2 — updated_at infrastructure (sin riesgo)
```
Nombre: 20260303_06_v2_updated_at_triggers.sql
SQL: CREATE FUNCTION v2_set_updated_at() + triggers sobre v2_stores.
     ADD COLUMN updated_at en v2_domain_events y v2_snapshots.
Riesgo: BAJO. ADD COLUMN con default no lockea en Postgres 11+.
```

### Paso 3 — Multi-tenant hardening (RIESGO MEDIO — requiere verificación previa)
```
Nombre: 20260303_07_v2_multitenant_not_null.sql
SQL: DELETE huérfanos (5 filas confirmadas) → ALTER COLUMN SET NOT NULL.
Riesgo: MEDIO. Lockeo breve en ALTER. Reversible si falla: ALTER COLUMN DROP NOT NULL.
Estrategia sin downtime: crear constraint NOT VALID primero, luego VALIDATE CONSTRAINT.
```

### Paso 4 — FK v2_snapshots.store_id (RIESGO BAJO)
```
Nombre: 20260303_08_v2_snapshots_fk.sql
SQL: ALTER TABLE v2_snapshots ADD CONSTRAINT fk_snap_store
     FOREIGN KEY (store_id) REFERENCES v2_stores(store_id) NOT VALID;
     ALTER TABLE v2_snapshots VALIDATE CONSTRAINT fk_snap_store;
Riesgo: BAJO. NOT VALID + VALIDATE es el patrón estándar sin lockeo.
```

### Paso 5 — Tie-breaker (ya disponible implícitamente)
El tie-breaker para `v2_domain_events` ya está cubierto: `normalized_at NOT NULL DEFAULT now()` + `source_event_id UNIQUE`. El determinismo está garantizado: dos eventos del mismo `source_event_id` son rechazados por la UNIQUE constraint. No se requiere columna adicional.

---

## E) Dictamen Arquitectónico

| Pregunta | Respuesta | Evidencia |
|----------|-----------|-----------|
| ¿DB reconstruible desde repo? | **NO** | 6 tablas sin CREATE en migrations |
| ¿domain_events es multi-tenant duro? | **NO** | `tenant_id`, `store_id` NULLABLE |
| ¿Existe core tipado materializado? | **NO** | v2_orders/payments/fulfillments no existen |
| ¿Determinismo del writer verificable? | **PARCIAL** | `source_event_id UNIQUE` garantiza idempotencia; `normalized_at NOT NULL` da tie-breaker |
| ¿updated_at garantizado en V2? | **NO** | 0 triggers en tablas V2 |

**Dictamen: NOT READY**

Razones específicas que bloquean producción:
1. `v2_domain_events` y `v2_snapshots` permiten NULLs en columnas de identidad — el motor clínico puede computar scores sin saber a qué tienda o tenant pertenecen.
2. El repo no puede reconstruir la DB — cualquier incidente de pérdida de datos es irrecuperable desde el repositorio.
3. Las tablas financieras tipadas no existen — el invariante "JSONB es evidencia, no dominio" no se cumple porque no hay dominio.

El sistema es **CONDITIONALLY READY** si se ejecutan los pasos 1–4 del Phase 1 Plan y los workers son verificados para no insertar NULLs.
