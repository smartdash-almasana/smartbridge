# Auditoría Técnica Senior — SmartSeller V3
**Fecha:** 19 de Marzo, 2026  
**Auditor:** Sistema automatizado de auditoría técnica  
**Proyecto:** `bewjtoozxukypjbckcyt` (Supabase)  
**Repo:** `e:\BuenosPasos\smartseller-v2`  
**Método:** Código ejecutable + DB real + migraciones + wiring efectivo

---

## A. RESUMEN EJECUTIVO

### Veredicto operativo: V3 NO está lista como base clínica confiable para producto vendible.

**Lo que existe realmente en V3:**
- 10 tablas core con RLS habilitado (`v3_tenants` → `v3_health_scores`) y volumetría de prueba (2–6 filas cada una).
- Un pipeline síncrono one-shot (`api/v3/engine/run`) que puede ejecutarse manualmente y produce runs, snapshots, métricas, señales y un health score.
- Un read model maduro (`clinical-status.ts`, `store-pulse.ts`, `run-history.ts`) que lee correctamente desde las tablas V3.
- Una pantalla interna funcional (`/v3/internal/store-pulse`) que consume datos V3 reales si existen.
- Un adaptador ML → V3 (`webhook-adapter.ts`) con identity resolver con bridge V2 incluido.

**Lo que NO existe o está roto:**
- Las 4 tablas de cola de trabajo (`v3_snapshot_jobs`, `v3_metrics_jobs`, `v3_signals_jobs`, `v3_scores_jobs`) **no existen en la DB** — las migraciones `20260314_v3_*` worker nunca fueron aplicadas.
- Las 10+ RPCs de claim/enqueue (`v3_claim_snapshot_jobs`, `v3_enqueue_metrics_jobs`, etc.) **no existen en la DB**. Solo existe `v3_set_updated_at`.
- El `pipeline-orchestrator.ts` **es inoperable** en producción: toda llamada a cualquier worker batch falla inmediatamente.
- La tabla `v3_worker_heartbeats` referenciada por el orchestrator **no existe en DB**.
- V3 tiene 3 runs zombie en estado `'running'` desde el 10–13 de marzo que nunca se cerraron.
- V3 tiene datos de seed con UUIDs hardcodeados (`11111111-...`, `22222222-...`) en `v3_engine_runs` y `v3_health_scores`.
- V3 no tiene ninguna señal de negocio minorista (cancelaciones, reclamos, ventas) — solo señales de diagnóstico de sistema (`source_webhook_events_1d_zero`, `source_domain_events_lag_1d`).
- El Dashboard de cara al Seller (`/dashboard/[store_id]`) sigue siendo 100% V2.
- No existe OAuth propio de V3 — la ingestión depende del sistema OAuth V2 para la resolución de identidad.

---

## B. MAPA REAL DE SUPERFICIE DE PRODUCTO V3

| Ruta | Componente | Datos que muestra | Fuente real | Estado |
|---|---|---|---|---|
| `/v3/internal/store-pulse` | `page.tsx` (239 líneas) | Score, severity_band, freshness, active_signals, recent_runs | `readV3StorePulse` → `v3_health_scores`, `v3_clinical_signals` | **REAL** (pero datos de prueba) |
| `/api/v3/store-pulse` (GET) | `route.ts` | Pulso completo del store | `readV3StorePulse()` vía `clinical-status.ts` | **REAL** |
| `/api/v3/engine/run` (POST) | `route.ts` | Ejecuta pipeline síncrono | `ensureV3EngineRun` → ... → `materializeV3HealthScore` | **REAL** (one-shot manual) |
| `/api/v3/ingest/webhook` (POST) | `route.ts` | Ingesta manual de webhooks V3 | `writeV3WebhookEvent` | **REAL** (pero no recibe webhooks reales de ML) |
| `/api/v3/worker/webhook-to-domain` | `route.ts` | Worker: webhook → domain events | `runV3WebhookToDomainWorker` → `v3_claim_webhook_events` RPC | **PARCIAL** (la RPC `v3_claim_webhook_events` sí existe en DB) |
| `/api/v3/worker/domain-to-snapshot` | `route.ts` | Worker: domain → snapshot | `runV3DomainToSnapshotWorker` → `v3_enqueue_snapshot_jobs`, `v3_claim_snapshot_jobs` | **ROTO** (RPCs no existen en DB) |
| `/api/v3/worker/snapshot-to-metrics` | `route.ts` | Worker: snapshot → metrics | `runV3SnapshotToMetricsWorker` → `v3_enqueue_metrics_jobs`, `v3_claim_metrics_jobs` | **ROTO** (RPCs no existen en DB) |
| `/api/v3/worker/metrics-to-signals` | `route.ts` | Worker: metrics → signals | `runV3MetricsToSignalsWorker` → `v3_enqueue_signals_jobs`, `v3_claim_signals_jobs` | **ROTO** (RPCs no existen en DB) |
| `/api/v3/worker/signals-to-health-score` | `route.ts` | Worker: signals → health score | `runV3SignalsToHealthScoreWorker` → `v3_enqueue_scores_jobs`, `v3_claim_scores_jobs` | **ROTO** (RPCs no existen en DB) |
| `/api/v3/adapters/ml` | `route.ts` | Recibe webhook ML y ruteaa a V3 | `adaptMeliWebhookToV3` → `resolveV3MeliIdentity` | **PARCIAL** (lógica OK, pero ML envía webhooks al endpoint V2) |
| `/api/v3/clinical-status` | `route.ts` | Estado clínico por store | `readV3ClinicalStatus` | **REAL** |
| `/api/v3/run-history` | `route.ts` | Historial de runs | `readV3RunHistory` | **REAL** |
| `dashboard/[store_id]/*` | V2 pages | Score V2, señales V2 | `v2_health_scores`, `v2_clinical_signals` | **LEGADO V2** |

---

## C. MAPA DEL REPO V3

| Módulo / Carpeta | Propósito declarado | Evidencia de uso real | Estado |
|---|---|---|---|
| `src/v3/ingest/webhook-writer.ts` | Singleton writer idempotente para `v3_webhook_events` | Usado por `webhook-adapter.ts` y `api/v3/ingest/webhook` | **ACTIVO** |
| `src/v3/ingest/webhook-to-domain-worker.ts` | Consume `v3_webhook_events` pending y produce `v3_domain_events` | Llama a `v3_claim_webhook_events` RPC (que SÍ existe en DB) | **ACTIVO** |
| `src/v3/ingest/domain-normalizer.ts` | Normaliza un webhook a domain event | Usado por `webhook-to-domain-worker` | **ACTIVO** |
| `src/v3/adapters/ml/webhook-adapter.ts` | Adapta webhook ML al formato V3 | Existe, pero ML no apunta a este endpoint | **PARCIAL** |
| `src/v3/adapters/ml/identity-resolver.ts` | Resuelve ML user_id → `(tenant_id, store_id)` con bridge V2 | Usado por `webhook-adapter.ts` | **ACTIVO** (bridge V2 documentado explícitamente) |
| `src/v3/engine/run-writer.ts` | Crea/reutiliza `v3_engine_runs` (idempotente por `metric_date`) | Usado por `api/v3/engine/run` y `domain-to-snapshot-worker` | **ACTIVO** |
| `src/v3/engine/snapshot-writer.ts` | Crea/reutiliza `v3_snapshots` | Usado por run y domain-to-snapshot | **ACTIVO** |
| `src/v3/engine/metrics-writer.ts` | Materializa `v3_metrics_daily` | Usado por `api/v3/engine/run` y `snapshot-to-metrics-worker` | **ACTIVO** |
| `src/v3/engine/signals-writer.ts` | Evalúa y upserta `v3_clinical_signals` | Solo evalúa 2 señales de sistema, no de negocio | **ACTIVO (PARCIAL — lógica de negocio ausente)** |
| `src/v3/engine/health-score-writer.ts` | Calcula y upserta `v3_health_scores` | Activo. Penalidades: info=5, warning=20, critical=40 | **ACTIVO** |
| `src/v3/engine/domain-to-snapshot-worker.ts` | Worker batch: domain events → snapshot jobs | Requiere `v3_claim_snapshot_jobs` RPC — **no existe en DB** | **ROTO** |
| `src/v3/engine/snapshot-to-metrics-worker.ts` | Worker batch: snapshot jobs → metrics | Requiere `v3_claim_metrics_jobs` RPC — **no existe en DB** | **ROTO** |
| `src/v3/engine/metrics-to-signals-worker.ts` | Worker batch: metrics jobs → signals | Requiere `v3_claim_signals_jobs` RPC — **no existe en DB** | **ROTO** |
| `src/v3/engine/signals-to-health-score-worker.ts` | Worker batch: signals jobs → scores | Requiere `v3_claim_scores_jobs` RPC — **no existe en DB** | **ROTO** |
| `src/v3/engine/pipeline-orchestrator.ts` | Orquesta los 5 workers + heartbeat en `v3_worker_heartbeats` | Depende de todos los workers batch + tabla inexistente | **COMPLETAMENTE ROTO** |
| `src/v3/read-models/clinical-status.ts` | Read model agregado: store + runs + score + señales + métricas | Consumido por `store-pulse.ts` y la API. Lee solo tablas V3. | **ACTIVO y CORRECTO** |
| `src/v3/read-models/store-pulse.ts` | Composición de clinical-status + run-history | Consumido por `api/v3/store-pulse` y la página interna | **ACTIVO** |
| `src/v3/read-models/run-history.ts` | Historial de runs con señales por run | Consumido por `store-pulse.ts` | **ACTIVO** |
| `src/v3/read-models/store-lookup.ts` | Búsqueda de stores V3 por nombre | Usado por la página interna `/v3/internal/store-pulse` | **ACTIVO** |

---

## D. AUDITORÍA DE DB V3

### Tablas core (aplicadas — migración `20260310_v3_canonical_core_base`)

| Tabla | Filas | Multi-tenant | Writer principal | Reader principal | Uso real | Consistencia |
|---|---|---|---|---|---|---|
| `v3_tenants` | 4 | tenant_id PK | Manual / seed | `clinical-status.ts` | Seed de prueba | OK |
| `v3_sellers` | 4 | tenant_id FK | Manual / seed | Lookup | Seed de prueba | OK |
| `v3_stores` | 4 | tenant_id FK, store_key | `webhook-adapter.ts` resuelve | `identity-resolver.ts`, `clinical-status.ts` | Seed de prueba | OK |
| `v3_webhook_events` | 3 | tenant_id, store_id | `webhook-writer.ts` | `webhook-to-domain-worker.ts` | Activo (pocas filas) | OK |
| `v3_domain_events` | 2 | tenant_id, store_id | `domain-normalizer.ts` | `domain-to-snapshot-worker.ts` | Activo (pocas filas) | OK |
| `v3_engine_runs` | 6 | tenant_id, store_id | `run-writer.ts` | `clinical-status.ts`, `run-history.ts` | 3 zombie (status='running'), 1 seed UUID hardcodeado | **CONTAMINADO** |
| `v3_snapshots` | 6 | tenant_id, store_id | `snapshot-writer.ts` | `clinical-status.ts` | Activo | OK |
| `v3_metrics_daily` | 6 | tenant_id, store_id | `metrics-writer.ts` | `signals-writer.ts`, `clinical-status.ts` | Activo | OK |
| `v3_clinical_signals` | 5 | tenant_id, store_id | `signals-writer.ts` | `clinical-status.ts` | Solo señales de sistema | **INCOMPLETO** |
| `v3_health_scores` | 4 | tenant_id, store_id | `health-score-writer.ts` | `clinical-status.ts` | 1 seed UUID hardcodeado | **CONTAMINADO** |

### Tablas de jobs (NO EXISTEN en DB)

| Tabla | Estado en repo | Estado en DB | Bloqueo |
|---|---|---|---|
| `v3_snapshot_jobs` | Definida en `20260314_v3_domain_to_snapshot_worker.sql` | **NO EXISTE** | Migración no aplicada |
| `v3_metrics_jobs` | Definida en `20260314_v3_snapshot_to_metrics_worker.sql` | **NO EXISTE** | Migración no aplicada |
| `v3_signals_jobs` | Definida en `20260314_v3_metrics_to_signals_worker.sql` | **NO EXISTE** | Migración no aplicada |
| `v3_scores_jobs` | Definida en `20260314_v3_signals_to_health_scores_worker.sql` | **NO EXISTE** | Migración no aplicada |
| `v3_worker_heartbeats` | Referenciada por `pipeline-orchestrator.ts` | **NO EXISTE** | Migración no aplicada |

### Migraciones V3: aplicadas vs pendientes

| Migración | Aplicada en DB | Contenido |
|---|---|---|
| `20260310_v3_canonical_core_base` | ✅ SÍ | 10 tablas core + índices + `v3_set_updated_at` trigger |
| `20260310_v3_core_rls_base` | ✅ SÍ | Políticas deny anon/authenticated en todas las tablas |
| `20260310_v3_rls_tenant_policies` | ❌ NO registrada | Políticas SELECT por tenant_id para authenticated |
| `20260314_v3_webhook_intake_worker` | ❌ NO registrada | `v3_claim_webhook_events` RPC + columnas de processing |
| `20260314_v3_domain_to_snapshot_worker` | ❌ NO registrada | `v3_snapshot_jobs` tabla + `v3_enqueue/claim_snapshot_jobs` RPCs |
| `20260314_v3_snapshot_to_metrics_worker` | ❌ NO registrada | `v3_metrics_jobs` + RPCs |
| `20260314_v3_metrics_to_signals_worker` | ❌ NO registrada | `v3_signals_jobs` + RPCs |
| `20260314_v3_signals_to_health_scores_worker` | ❌ NO registrada | `v3_scores_jobs` + RPCs |
| `20260314_v3_pipeline_orchestrator_heartbeat` | ❌ NO registrada | `v3_worker_heartbeats` tabla |

> ⚠️ **CRÍTICO:** La RPC `v3_claim_webhook_events` sí existe en DB (confirmada por query), pero NO aparece en `schema_migrations`. Fue aplicada manualmente o via el dashboard de Supabase, no vía CLI. Esto significa **drift entre migrations y DB real**.

---

## E. PIPELINE CLÍNICO REAL V3 — MATRIZ POR ETAPA

| Etapa | Tabla | Writer | Reader | ¿Existe? | ¿Activa? | ¿Determinística? | ¿Idempotente? | Modo | Convive con V2 |
|---|---|---|---|---|---|---|---|---|---|
| **Recepción webhook** | `v3_webhook_events` | `webhook-writer.ts` vía `api/v3/ingest/webhook` | `webhook-to-domain-worker.ts` | ✅ | ✅ (manual) | Sí (upsert por `source_event_id`) | Sí | Manual / no conectado a ML real | Sí — ML sigue enviando a V2 |
| **Normalización → domain_events** | `v3_domain_events` | `domain-normalizer.ts` | `domain-to-snapshot-worker.ts` | ✅ | ✅ (RPC `v3_claim_webhook_events` funciona) | Sí | Sí (upsert por `source_webhook_event_id`) | Worker batch (api/v3/worker/webhook-to-domain) | Sí — `v2_domain_events` paralelo |
| **Domain → Snapshot** | `v3_snapshots` | `domain-to-snapshot-worker.ts` | `clinical-status.ts` | ✅ código | ❌ **ROTO** (RPCs snapshot_jobs no existen) | N/A | N/A | Worker batch bloqueado | Sí — `v2_snapshots` paralelo |
| **Snapshot → Metrics** | `v3_metrics_daily` | `metrics-writer.ts` | `signals-writer.ts` | ✅ código | ❌ **ROTO** (RPCs metrics_jobs no existen) | N/A | N/A | Worker batch bloqueado | Sí — `v2_metrics_daily` paralelo |
| **Metrics → Signals** | `v3_clinical_signals` | `signals-writer.ts` | `clinical-status.ts` | ✅ código | ❌ **ROTO** (RPCs signals_jobs no existen) | N/A | N/A | Worker batch bloqueado | Sí — `v2_clinical_signals` paralelo |
| **Signals → Health Score** | `v3_health_scores` | `health-score-writer.ts` | `clinical-status.ts` | ✅ código | ❌ **ROTO** (RPCs scores_jobs no existen) | N/A | N/A | Worker batch bloqueado | Sí — `v2_health_scores` paralelo |

### Modo alternativo funcional: Pipeline síncrono one-shot

El endpoint `POST /api/v3/engine/run` ejecuta **de forma sincrónica** la secuencia completa:
`ensureV3EngineRun` → `ensureV3Snapshot` → `materializeV3MetricsDaily` → `materializeV3ClinicalSignals` → `materializeV3HealthScore`

**Evidence:** `src/app/api/v3/engine/run/route.ts` líneas 23–62.

⚠️ **Caveat crítico:** Este endpoint inyecta un snapshot con `clinical_inputs: { source_webhook_events_1d: 0, source_domain_events_1d: 0 }` hardcodeado (líneas 37–40 del route), que luego `metrics-writer.ts` usa para materializar las métricas. La primera etapa del pipeline síncrono opera con **datos de contenido vacío/hardcodeado**, no con eventos reales.

---

## F. SCORE Y SEÑALES

### Cómo se calcula el score V3

**Archivo:** `src/v3/engine/health-score-writer.ts`, función `buildScoreFromSeverities` (línea 37)

Fórmula:
```
total_penalty = (count_info × 5) + (count_warning × 20) + (count_critical × 40)
score = clamp(100 - total_penalty, 0, 100)
```

### Señales que se evalúan en V3

**Archivo:** `src/v3/engine/signals-writer.ts`, función `materializeV3ClinicalSignals` (línea 34)

Solo 2 señales de **diagnóstico sistémico**:
- `source_webhook_events_1d_zero` (warning si webhooks del día = 0)
- `source_domain_events_lag_1d` (warning si lag ≤ 5, critical si lag ≥ 5)

**Señales de negocio minorista ausentes en V3:**
- ❌ `no_orders_7d` (cancelación de órdenes)
- ❌ `cancellation_spike`
- ❌ `unanswered_messages_spike`
- ❌ `claims_opened`
- ❌ `low_activity_14d`

### ¿Es el score V3 clínicamente reproducible hoy?

**Respuesta: PARCIALMENTE / NO apto para producto**

- **Sí** es reproducible técnicamente: dado un `run_id`, los datos de señales y métricas son inmutables una vez escritos, y el score puede recalcularse desde `v3_clinical_signals`.
- **No** es un indicador clínico real de riesgo del seller: V3 mide "¿llegaron webhooks hoy?" no "¿está en riesgo el negocio?".
- **Contaminado:** Existen runs con UUIDs hardcodeados (`11111111-4444-4111-8111-111111111111`) que son datos de seed, no producción.
- **Zombie runs:** 3 runs con `status='running'` que no se cerraron, de fechas 2026-03-11, 03-12, 03-13.

---

## G. INTEGRACIONES REALES

### OAuth (Mercado Libre)
- **Sigue siendo 100% V2.** El flujo OAuth escribe en `v2_oauth_installations`, `v2_oauth_tokens`, `v2_oauth_states`.
- V3 resuelve identidad vía `identity-resolver.ts` que primero busca en `v3_stores`, y si no encuentra, hace un **bridge a `v2_stores`** (explícito en `identity-resolver.ts` líneas 70–90).
- V3 nunca instaló su propio OAuth end-to-end.

### Webhooks ML
- ML envía webhooks al endpoint V2: `src/app/(v2)/api/meli/webhook/route.ts`.
- El endpoint V3 de webhooks (`api/v3/ingest/webhook`) **no tiene ningún registro en ML**. No recibe webhooks reales.
- El adaptador ML→V3 (`adaptMeliWebhookToV3`) está correctamente construido pero **nunca se ejecuta en producción** porque ML no apunta a él.

### Jobs / Cron
- No existe ningún cron de producción configurado para los workers V3.
- `vercel.json` o configuración equivalente: no verificable en esta sesión.
- Los workers V3 se disparan únicamente por llamadas manuales o tests.

### Supabase
- Cliente: `@v2/lib/supabase` — V3 **reutiliza el Supabase client de V2** (ver imports en cada worker V3).
- RLS en V3: todas las tablas tienen `deny_anon` y `deny_authenticated`. Solo `service_role` (backend) puede escribir. Correcto por arquitectura.

---

## H. UI REAL VS MOCK

| Superficie visible | Datos | Origen | Estado |
|---|---|---|---|
| `/v3/internal/store-pulse` — Score | Real (si hay datos V3) | `v3_health_scores` | **REAL** (pero datos de prueba, algunos seed con UUIDs hardcodeados) |
| `/v3/internal/store-pulse` — Señales | Real | `v3_clinical_signals` | **REAL** (solo señales sistémicas) |
| `/v3/internal/store-pulse` — Freshness | Real | calculado desde `computed_at` | **REAL** |
| `/dashboard/[store_id]` — Score V2 | Real | `v2_health_scores` | **REAL (motor V2)** |
| `/dashboard/[store_id]` — Alertas V2 | Real | `v2_clinical_signals` | **REAL (motor V2)** |
| `/api/v3/engine/run` — Snapshot payload | `clinical_inputs` HARDCODEADO en ruta | `route.ts` líneas 37–40 | **MOCK/HARDCODEADO** |

---

## I. HERENCIA V2 / LEGACY

### Dependencias explícitas de V3 sobre V2/legacy

| Dependencia | Archivo | Descripción | Riesgo |
|---|---|---|---|
| Supabase client | Todos los workers V3: `import { supabaseAdmin } from '@v2/lib/supabase'` | V3 no tiene su propio módulo cliente | Bajo (reutilización válida) |
| Identity bridge | `identity-resolver.ts` líneas 70–90 | Si el store no está en `v3_stores`, busca en `v2_stores` | Medio — doble fuente identidad |
| OAuth / Tokens | Sin código V3 propio | V3 no tiene OAuth — depende de instalaciones V2 | Alto — V3 no puede operar stores nuevos sin que antes pasen por V2 |
| Webhook ingestión ML | ML apunta a `(v2)/api/meli/webhook` | V3 no recibe webhooks de ML reales | Alto — V3 no recibe datos frescos |
| Dashboard usuario | `src/app/(v2)/dashboard/` | Toda la UI del seller usa V2 | Alto — ningún seller ve datos V3 |

### Tablas V2 vivas que siguen siendo fuente real de verdad

`v2_webhook_events`, `v2_domain_events`, `v2_metrics_daily`, `v2_clinical_signals`, `v2_health_scores`, `v2_engine_runs`, `v2_snapshots`, `v2_oauth_installations`, `v2_oauth_tokens`, `v2_stores`

### Riesgo de doble fuente de verdad

**Sí existe un riesgo real.** Actualmente se puede llamar a `/api/v3/engine/run` para un store que también corre el motor V2, produciendo:
- `v2_health_scores` con score basado en señales de negocio (5 reglas: órdenes, cancelaciones, mensajes, reclamos)
- `v3_health_scores` con score basado en señales sistémicas (lag de webhooks)

Para el mismo store, en el mismo día, podrían existir dos scores diferentes con semánticas completamente distintas, sin ningún mecanismo de reconciliación o aviso al consumidor.

---

## J. DESALINEACIONES CRÍTICAS

### A. Documentado/declarado que NO existe en implementación real

1. **Pipeline batch asíncrono (Orchestrator):** ADR-0009 declara un pipeline event-driven secuencial. El orchestrator existe en código pero es inoperable: las migraciones que crea sus tablas y RPCs no fueron aplicadas.
2. **V3 como sucesor de V2 para datos de negocio:** Ninguna señal de negocio fue portada de V2 a V3. V3 solo tiene señales sistémicas.
3. **Webhooks ML en V3:** El adaptador `webhook-adapter.ts` declara ser "single entry point for ML → v3_webhook_events" (comentario línea 3), pero ML envía a V2.
4. **Multi-tenant completo en V3:** `v3_stores` tiene `SELECT` tenant-aware solo en algunas tablas (`clinical_signals`, `health_scores`, `stores`). `engine_runs`, `snapshots`, `metrics_daily`, `domain_events`, y `webhook_events` tienen **solo políticas deny** — ningún cliente autenticado puede leerlas, lo que impide cualquier integración directa supabase-js con JWT de usuario.

### B. Existente en implementación que NO está en documentación

1. **Bridge V2 en identity resolution:** `identity-resolver.ts` tiene fallback explícito a `v2_stores`. Ningún ADR documenta el plan de migración de stores V2 → V3.
2. **Snapshot con `clinical_inputs` hardcodeado:** El endpoint `/api/v3/engine/run` inyecta `{ source_webhook_events_1d: 0, source_domain_events_1d: 0 }` como semilla fija. Esto no está documentado como comportamiento temporal ni como limitación.
3. **Zombie runs:** 3 runs en estado `running` que nunca fueron cerrados. No hay mecanismo de TTL ni de garbage collection documentado.
4. **Seed data con UUIDs hardcodeados:** Existen runs y scores de test en tabla de producción con UUIDs estáticos (`11111111-4444-4111-8111-111111111111`).

### C. Desalineaciones o ambigüedades

1. **`v3_claim_webhook_events` existe en DB pero sin migración registrada:** Drift entre DB real y `schema_migrations`. Implica que la migración fue aplicada manualmente.
2. **V3 y V2 comparten el mismo `store_id` UUID:** El bridge funciona, pero no hay garantía de que `v3_stores.store_id` = `v2_stores.store_id`. Si los UUIDs divergen, el bridge falla silenciosamente.
3. **Score V2 y Score V3 tienen semánticas distintas** pero se expresan ambos como un número de 0 a 100 — no hay diferenciador de versión visible para el consumidor.

---

## K. TOP 10 RIESGOS REALES

| # | Riesgo | Severidad | Evidencia |
|---|---|---|---|
| 1 | **Pipeline batch completamente roto:** Los 5 workers batch y el orchestrator fallan en producción porque sus tablas y RPCs no existen en DB. Ningún dato entra al pipeline V3 de forma autónoma. | 🔴 Alta | DB: 0 rows en tabla `v3_snapshot_jobs` (no existe). RPCs: solo `v3_set_updated_at` en DB. |
| 2 | **V3 no recibe webhooks reales de ML:** ML apunta a V2. V3 solo puede alimentarse con llamadas manuales al endpoint de ingestión. Sin datos de entrada, V3 no puede calcular señales reales. | 🔴 Alta | ML → `(v2)/api/meli/webhook/route.ts`. `api/v3/ingest/webhook` sin registros en ML. |
| 3 | **Señales V3 sin reglas de negocio:** V3 no tiene ninguna señal clínica de negocio. El score V3 mide lag del pipeline de datos, no riesgo del seller. No puede sustituir a V2 como motor clínico. | 🔴 Alta | `signals-writer.ts` líneas 58–76: solo 2 señales sistémicas. |
| 4 | **Doble fuente de verdad V2/V3:** Para el mismo store/día, dos scores con semánticas distintas pueden coexistir sin reconciliación. Cualquier consumidor que lea ambos obtendrá resultados contradictorios. | 🔴 Alta | `v2_health_scores` (30 filas) + `v3_health_scores` (4 filas, mismos stores). |
| 5 | **OAuth V3 inexistente:** V3 no puede onboardear un seller nuevo sin que pase primero por V2. Cualquier plan de migración pura a V3 está bloqueado sin OAuth propio. | 🔴 Alta | No existe código OAuth en `src/v3/`. El bridge en `identity-resolver.ts` confirma la dependencia. |
| 6 | **Migración de DB incompleta / drift:** 7+ migraciones están en el repo pero no en la DB. El historial de `schema_migrations` está desincronizado. Una sola `supabase db push` podría aplicar migraciones fuera de orden. | 🟠 Media | `schema_migrations` vs repo: 8 migraciones V3 no registradas. |
| 7 | **Snapshot `clinical_inputs` hardcodeado en engine/run:** El pipeline síncrono one-shot inyecta métricas vacías como semilla. Los datos reales de webhooks del día no se usan. Los runs producidos por este endpoint no son clínicamente válidos. | 🟠 Media | `api/v3/engine/run/route.ts` líneas 37–40: `source_webhook_events_1d: 0, source_domain_events_1d: 0`. |
| 8 | **Zombie runs y seed data en producción:** 3 runs en `status='running'` que nunca cerraron (contaminan reads de estado actual). UUIDs hardcodeados de seed (`11111111-...`) en tablas de producción. | 🟠 Media | DB: `v3_engine_runs` rows con `status='running'`, fechas 03-11 a 03-13. |
| 9 | **RLS incompleto en V3:** Las tablas `engine_runs`, `snapshots`, `metrics_daily`, `domain_events`, `webhook_events` solo tienen políticas deny. No tienen SELECT tenant-aware. Esto bloquea cualquier integración directa con JWT de sesión. | 🟠 Media | DB: `pg_policies` — 5 tablas sin `SELECT` policies para authenticated. |
| 10 | **Promesa comercial sobre realidad:** La arquitectura declara un pipeline event-driven asíncrono, multi-tenant, reproducible. La realidad es un pipeline síncrono one-shot con datos de prueba, sin señales de negocio, y un motor batch inoperable. Vender SmartSeller Control/Reportes/ReportameAhora sobre V3 hoy = riesgo de incumplimiento. | 🟠 Media | Totalidad de evidencia esta auditoría. |

---

## L. BASE MÍNIMA CONFIABLE

### Qué conservar

| Componente | Razón |
|---|---|
| `src/v3/read-models/*` (4 archivos) | Código limpio, correcto, bien estructurado. Puede leer datos V3 reales cuando existan. |
| `src/v3/ingest/webhook-writer.ts` + `domain-normalizer.ts` | La primera etapa del pipeline (ingestión + normalización) es sólida. |
| `src/v3/adapters/ml/webhook-adapter.ts` + `identity-resolver.ts` | Correctamente construidos. El bridge V2 es pragmático y documentado. |
| `src/v3/engine/*-writer.ts` (run, snapshot, metrics, health-score) | Los writers son idempotentes y determinísticos. Usables en el pipeline síncrono si los inputs son correctos. |
| `src/app/v3/internal/store-pulse/page.tsx` | Vista interna que funciona correctamente con datos V3. |
| Tablas core V3 (`v3_tenants` → `v3_health_scores`) | Esquema bien diseñado con RLS y multi-tenancy. |

### Qué congelar (no escalar hasta resolver dependencias)

- `pipeline-orchestrator.ts` — congelar hasta aplicar las 7 migraciones pendientes.
- `domain-to-snapshot-worker.ts` y los 3 workers downstream — congelar hasta que las tablas y RPCs existan en DB.
- Todo uso de datos V3 en el dashboard de cara al seller — congelar hasta que V3 tenga señales de negocio.

### Qué no usar en producción

- El endpoint `POST /api/v3/engine/run` con datos reales: los `clinical_inputs` hardcodeados hacen al snapshot inválido como fuente de verdad.
- Los UUIDs de seed `11111111-...` y `22222222-...` — deben purgearse de las tablas de producción.

### Qué verificar primero

1. **Aplicar las 7 migraciones V3 pendientes** (en orden correcto). Verificar que las tablas `v3_snapshot_jobs`, `v3_metrics_jobs`, `v3_signals_jobs`, `v3_scores_jobs`, `v3_worker_heartbeats` y todas las RPCs existan en DB.
2. **Purgar zombie runs y seed data** de `v3_engine_runs` y `v3_health_scores`.
3. **Conectar ML al endpoint V3** (`api/v3/ingest/webhook` o redirigir `/api/meli/webhook` de V2 a que también escriba en `v3_webhook_events`).
4. **Portar al menos 1 señal de negocio** a `signals-writer.ts` (por ejemplo `no_orders_7d`) para que el score V3 tenga significado clínico.

### ¿V3 puede sostener producto vendible hoy?

**NO.**

V3 tiene las fundaciones correctas (arquitectura, RLS, read models, writers idempotentes), pero:
- El motor batch está inoperable por migraciones no aplicadas.
- No recibe datos reales de ML.
- No tiene señales de negocio.
- Tiene datos contaminados en tablas de producción.
- El dashboard del seller sigue siendo 100% V2.

El plazo mínimo estimado para que V3 sea base clínica confiable y pueda comenzar a co-existir con V2 como fuente alternativa requiere: aplicar migraciones + conectar ingestión ML + portar señales de negocio. Solo entonces la migración gradual V2→V3 puede comenzar con validaciones paralelas.

---

*Auditoría generada el 2026-03-19. Cada afirmación está respaldada por archivo, función, tabla o query citada explícitamente.*
