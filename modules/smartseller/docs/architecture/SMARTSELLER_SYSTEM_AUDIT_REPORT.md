# SmartSeller V2 — System Audit Report

```
Repo   : E:\BuenosPasos\smartseller-v2
DB     : bewjtoozxukypjbckcyt.supabase.co  (sa-east-1)
Date   : 2026-03-08
Auditor: Antigravity — Principal Technical Auditor
```

---

## 1. Repo Structure (depth ≤ 4)

```
smartseller-v2/
├── docs/                         # All documentation
│   ├── qa/                       # ← SMARTSELLER_SYSTEM_AUDIT.sql (this audit)
│   ├── architecture/             # ← SMARTSELLER_SYSTEM_AUDIT_REPORT.md (this report)
│   ├── adr/                      # Architecture Decision Records
│   ├── runbooks/
│   └── audit-*.md                # Individual component audits
├── src/
│   ├── app/
│   │   ├── (v2)/api/
│   │   │   ├── engine/[store_id]/   # POST → trigger engine run per store
│   │   │   ├── score/[store_id]/    # GET  → return score for store
│   │   │   ├── worker/
│   │   │   │   ├── v2-webhook-to-domain/route.ts   # Worker HTTP entrypoint
│   │   │   │   ├── meli-reconcile/                 # Reconcile worker
│   │   │   │   └── token-refresh/                  # Token refresh worker
│   │   │   └── ingest/, normalize/, meli/
│   │   └── (legacy)/             # V1 app routes (NOT used in V2 pipeline)
│   └── v2/
│       ├── engine/               # ← CLINICAL ENGINE
│       │   ├── run-daily-clinical-v0.ts   # Orchestrator (Phase 3.A4)
│       │   ├── refund-metrics-worker.ts   # Worker: refund spike detection
│       │   ├── payments-unlinked-worker.ts # Worker: unlinked payments
│       │   ├── zero-price-items-worker.ts  # Worker: zero-price listings
│       │   └── runner.ts                  # RPC adapter: v2_run_engine_for_store
│       ├── ingest/               # ← WEBHOOK PIPELINE
│       │   ├── webhook-to-domain-worker.ts # Core ingest worker
│       │   ├── normalizer.ts
│       │   ├── webhook-handler.ts
│       │   └── ingest-attempts.ts
│       ├── typed-writer/         # Domain→Entity writers (orders, payments, refunds)
│       ├── api/score.ts          # Score computation logic
│       └── lib/
│           ├── supabase.ts
│           └── meli-token.ts
├── supabase/migrations/          # 14 migration files
└── scripts/demo.sh
```

---

## 2. Workers Detectados

| Worker | Archivo | Tipo | Estado |
|---|---|---|---|
| `ingest-webhook-to-domain` | `v2/ingest/webhook-to-domain-worker.ts` | Ingest | **DEAD** (last: 2026-03-03) |
| `refund-metrics-worker` | `v2/engine/refund-metrics-worker.ts` | Clinical | On-demand |
| `payments-unlinked-worker` | `v2/engine/payments-unlinked-worker.ts` | Clinical | On-demand |
| `zero-price-items-worker` | `v2/engine/zero-price-items-worker.ts` | Clinical | On-demand |
| `run-daily-clinical-v0` | `v2/engine/run-daily-clinical-v0.ts` | Orchestrator | On-demand |
| `meli-reconcile` | `app/(v2)/api/worker/meli-reconcile/` | Reconcile | Via HTTP/CRON |
| `token-refresh` | `app/(v2)/api/worker/token-refresh/` | Token ops | Via CRON |

---

## 3. Tablas Reales Detectadas en Supabase

### Pipeline Canónico V2

| Tabla Real | Alias | Filas | Última Actividad | Freshness | Multi-tenant |
|---|---|---|---|---|---|
| `v2_webhook_events` | webhooks | **11** | 2026-03-03 22:55 UTC | WARM | tenant\_id + store\_id ✅ |
| `v2_domain_events` | domain\_events | **6** | 2026-03-03 22:56 UTC | WARM | tenant\_id + store\_id ✅ |
| `v2_snapshots` | snapshots | **9** | 2026-03-03 16:07 UTC | WARM | tenant\_id + store\_id ✅ |
| `v2_metrics_daily` | metrics | **4** | 2026-03-03 (date) | WARM | tenant\_id + store\_id ✅ |
| `v2_clinical_signals` | clinical\_signals | **18** | 2026-03-03 23:33 UTC | WARM | tenant\_id + store\_id ✅ |
| `v2_health_scores` | health\_score | **12** | 2026-03-03 23:33 UTC | WARM | tenant\_id + store\_id ✅ |

### Runtime / Worker / Infraestructura

| Tabla | Filas | Nota |
|---|---|---|
| `v2_engine_runs` | 12 | History de ejecuciones del motor clínico |
| `v2_worker_heartbeats` | 5 | Todos DEAD (last: 2026-03-03 22:56 UTC) |
| `v2_webhook_ingest_jobs` | 11 | 6 done / 5 failed |
| `v2_ingest_attempts` | 56 | Log append-only de intentos |
| `v2_cron_runs` | 768 | **144 runs exitosos en últimas 24h** ✅ |
| `v2_dlq_events` | 1 | 1 evento open en DLQ |
| `v2_runtime_metrics_minute` | 0 | Sin datos (worker sin actividad) |
| `v2_domain_events_quarantine` | 5 | Eventos normalizados con issues |

### Tablas Heredadas V1 (coexistentes, NO parte del pipeline V2)

| Tabla | Filas | Nota |
|---|---|---|
| `webhook_events` | 10 | Legacy, sin uso en V2 |
| `health_scores` | 48 | Legacy, reemplazada por `v2_health_scores` |
| `engine_runs` | 53 | Legacy, reemplazado por `v2_engine_runs` |
| `signal_state` | 5 | Legacy, reemplazada por `v2_clinical_signals` |

---

## 4. Pipeline Map

```
┌─────────────────────────────────────────────────────────────────────┐
│   SMARTSELLER V2 — PIPELINE CLÍNICO (estado: 2026-03-08)           │
└─────────────────────────────────────────────────────────────────────┘

[INGEST] ───────────────────────────────────────────────────────────────

  v2_webhook_events (11 rows) → WARM
    ↓ 
  [Worker: ingest-webhook-to-domain] ← DEAD (last: 2026-03-03)
    ↓
  v2_domain_events (6 rows) → WARM
    ↑
    └── 5 webhooks UNPROCESSED (job_status=failed) ← STALL POINT

[ENGINE] ────────────────────────────────────────────────────────────────

  [Orchestrator: run-daily-clinical-v0] ← On-demand, last run: 2026-03-03
    ↓
  v2_snapshots (9 rows) → WARM
    ↓
  v2_metrics_daily (4 rows) → WARM
    ↓
  v2_clinical_signals (18 rows) → WARM
    ↓
  v2_health_scores (12 rows) → WARM
    avg_score=56.25, range=[0..95]

[TRACEABILITY] ──────────────────────────────────────────────────────────

  v2_health_scores → v2_engine_runs → v2_clinical_signals  ✅ traceable
  snapshot_id on signals = NULL  ⚠️ (score→snapshot link incomplete)

[RUNTIME] ───────────────────────────────────────────────────────────────

  v2_cron_runs → 144 OK runs in last 24h ✅ (scheduler alive via pg_cron)
  v2_worker_heartbeats → ALL 5 instances DEAD
  v2_runtime_metrics_minute → 0 rows (worker not reporting)
```

---

## 5. Hallazgos Críticos

### 🔴 CRÍTICO — Worker DEAD

El worker `ingest-webhook-to-domain` lleva **5 días sin heartbeat** (último: 2026-03-03 22:56 UTC). Esto implica:
- 5 webhooks `orders_v2` en estado `failed` sin procesar
- 1 evento abierto en DLQ
- Sin nuevos domain\_events posibles hasta que el worker vuelva a ejecutarse

### 🟡 IMPORTANTE — 5 Webhooks Unprocessed (STALLED)

Los 5 webhooks `orders_v2` sin procesar tienen `job_status=failed`. Sus ingest jobs tienen estado `failed` y **nunca alcanzaron dead\_letter**. Requieren retry manual o restart del worker.

### 🟡 IMPORTANTE — snapshot_id NULL en v2_clinical_signals

La columna `snapshot_id` en `v2_clinical_signals` es `NULL` en todos los registros. La trazabilidad entre Score → Signal → Snapshot está **rota** (se puede ir de Score a Signal a Run, pero no a Snapshot directamente).

### 🟢 OK — Scheduler Cron Activo

`v2_cron_runs` registra 144 ejecuciones exitosas en las últimas 24h. La capa de scheduling de Supabase/pg\_cron está **operativa**. El problema no es el scheduler sino el proceso del worker en el runtime de Vercel/Edge.

### 🟢 OK — Multi-tenant Safety

Todas las tablas del pipeline V2 tienen `tenant_id` y `store_id`. No se detectaron tablas core sin escoping.

### 🟢 OK — Trazabilidad Score → Run → Signal

La cadena `v2_health_scores → v2_engine_runs → v2_clinical_signals` es trazable vía `run_id`. FK verificadas y funcionales.

---

## 6. Fase del Sistema

| Dimensión | Valor |
|---|---|
| **highest\_achieved\_phase** | **F5** (Health Score reached) |
| **current\_operational\_phase** | **F5** (todos los datos en WARM, <7d) |
| **current\_operational\_status** | **STALLED** (worker DEAD) |
| **primary\_blocker** | `worker_runtime_dead` |

> **Interpretación:** El sistema *alguna vez* alcanzó F5 completa, con score calculado, señales emitidas y snapshots generados. Operativamente hoy, todos los datos tienen entre 4-5 días de antigüedad (WARM), lo que significa que el sistema no está muerto — está **congelado**. Los datos históricos son válidos. Pero sin el worker activo, no ingresará nueva data ni generará nuevas señales.

---

## 7. Bloqueadores Técnicos para Producto Final

| Prioridad | Bloqueador | Impacto | Acción |
|---|---|---|---|
| 🔴 P0 | `worker_runtime_dead` — ingest-webhook-to-domain no corre | Sin nuevos domain\_events | Re-deployar o re-activar el worker en Vercel/Edge |
| 🔴 P0 | 5 jobs fallidos sin retry | Backlog de eventos `orders_v2` | Resetear jobs a `pending` para que el worker los procese |
| 🟡 P1 | `snapshot_id NULL` en v2\_clinical\_signals | Trazabilidad Score→Snapshot rota | Completar el link en el orchestrator (paso de Phase 3) |
| 🟡 P1 | DLQ con 1 evento open | Pipeline no limpio | Investigar y resolver el evento en `v2_dlq_events` |
| 🟢 P2 | v2\_state\_snapshots = 0 filas | engine no escribe state snapshots | Verificar si el orchestrator debe escribir aquí |
| 🟢 P2 | Tables V1 coexistentes | Potencial confusión para agentes/IA | Guardrails: documentar que son legacy y no parte del pipeline V2 |

---

## 8. Evidencia de Ejecución

La evidencia proviene de consultas directas a Supabase durante esta auditoría:

- `v2_worker_heartbeats`: 5 instancias, todas DEAD (age >4 días)
- `v2_cron_runs`: 144 runs OK en últimas 24h (scheduler funcional)
- `v2_webhook_ingest_jobs`: 6 done + 5 failed (0 pending, 0 dead\_letter)
- Score range: 0–95, avg 56.25 (datos de 2026-03-03)
- Último run exitoso: `v2_engine_runs` status=done, 2026-03-03 23:33

---

*Script de Auditoría:* [`docs/qa/SMARTSELLER_SYSTEM_AUDIT.sql`](../qa/SMARTSELLER_SYSTEM_AUDIT.sql)  
*Pipeline canónico V2 verificado contra tablas reales en Supabase.*
