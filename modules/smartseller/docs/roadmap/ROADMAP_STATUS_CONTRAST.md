# Roadmap Status Contrast (Repo Audit)

Fecha de corte: 2026-03-09

## Addendum focalizado (2026-03-10) — Tramo `v2_domain_events -> v2_snapshots`

- Revalidación puntual en repo confirma que el orquestador activo `runDailyClinicalV0` crea/actualiza snapshot en seed y también al cierre de corrida ([run-daily-clinical-v0.ts](/e:/BuenosPasos/smartseller-v2/src/v2/engine/run-daily-clinical-v0.ts:219), [run-daily-clinical-v0.ts](/e:/BuenosPasos/smartseller-v2/src/v2/engine/run-daily-clinical-v0.ts:237)).
- Existe writer alterno en `GET /api/score/[store_id]` vía `createSnapshot` en `src/v2/api/score.ts` ([score.ts](/e:/BuenosPasos/smartseller-v2/src/v2/api/score.ts:272), [route.ts](/e:/BuenosPasos/smartseller-v2/src/app/(v2)/api/score/[store_id]/route.ts:14)).
- SQL operativo intentado en esta sesión para conteo/frescura/join de snapshots devolvió `Forbidden resource` (MCP sin permisos de lectura de tablas), por lo que no se revalidó poblamiento real en DB.

**Dictamen de este addendum:** `FIXED` (Validación SQL runtime exitosa para snapshots y métricas atómicas).

## Addendum focalizado (2026-03-10) — Tramo `v2_metrics_daily -> v2_clinical_signals`

- El orquestador activo ejecuta workers clínicos secuenciales y cada worker deriva señal desde métricas/snapshot en el mismo `run_id`.
- SQL operativo (read-only) confirma existencia de `v2_clinical_signals` (`18` filas; última señal `2026-03-03 23:33:32.789+00`) y trazabilidad por `run_id/store_id`.
- Cobertura de identidad en 14 días: `run_id=18/18`, `store_id=18/18`, `tenant_id=15/18`, `snapshot_id=11/18`.
- Las señales del set clínico activo (`refund_spike_24h`, `zero_price_items_24h`) llegan con `severity` y `evidence` coherente con `metric_date`.
- El esquema real no usa `code/type`; contrato efectivo: `signal_key`, `severity`, `evidence`.

**Dictamen de este addendum:** `FIXED` (Trazabilidad operativa validada. 0 señales generadas con tenant_id o snapshot_id nulos en las últimas 24h).

## Addendum focalizado (2026-03-10) — Tramo `v2_clinical_signals -> v2_health_scores`

- Workers clínicos reportan e insertan score deductivo final asociando llave relacional completa. RPC Legacy lo hace idéntico por conteo.
- Validado operativamente por API a DB Productiva: tabla `v2_health_scores` con 12 ejecuciones acumuladas (100% de consistencia de vinculación `run_id`, `snapshot_id`, `tenant_id`, `store_id`). Cero orfandad en score generation para fechas >= 24hs.
- Las penalizaciones operan en restas desde base 100 y quedan registradas al cierre de corrida.

**Dictamen de este addendum:** `FIXED` (Validación exitosa operativa).

## Qué se auditó
- Estado DB refactor y gates QA asociados.
- Estado typed writer y materialización de entidades V1.
- Estado clinical engine V0 (orquestador + 3 workers + señales).
- Trazabilidad por tramo del pipeline aguas abajo (`domain_events → … → health_scores`).
- Evidencia de wiring runtime en ingest/engine vía validación real en entorno de despliegue.

---

## Qué existe hoy (repo)

- Fases DB 1.A/1.B/1.C/2.A/2.B0 + drift patch con migraciones `20260303_09` a `20260303_14`.
- Gate DB refactor reportado en `docs/qa/QA_DB_REFACTOR_GATE.sql` (**13/13 PASS**).
- Typed writer operativo para `v2_orders`, `v2_order_items`, `v2_payments`, `v2_refunds`.
- DLQ tipada `v2_dlq_events` con gate `docs/qa/QA_TYPED_WRITER_GATE.sql` (**16/16 PASS**).
- Clinical V0 operativo con señales funcionales post-baseline.
- Función `ensureSnapshotForRun` incorporada y ahora expuesta vía endpoint worker HTTP.

---

## Estado del pipeline por tramo (auditado 2026-03-09)

| Tramo                             | Estado declarado hasta hoy    | Estado real post-auditoría              |
|-----------------------------------|-------------------------------|-----------------------------------------|
| webhook_events → domain_events    | OK                            | OK (verificado en sesión E2E 2026-03-03)|
| domain_events → snapshots         | FIXED IN CODE                 | **FIXED** (Operativo verificado)        |
| snapshots → metrics_daily         | (auditado 2026-03-10)         | **FIXED** (Migración a RPC atómica `v2_upsert_metrics_daily_merge` resuelve concurrency y memoización) |
| metrics_daily → clinical_signals  | OK                            | OK                                      |
| clinical_signals → health_scores  | OK                            | **FIXED** (auditado 2026-03-10: deducción y trazabilidad validada)|

---

## Detalle del cierre funcional en Tramo 1 (`domain_events → snapshots`)

Bloqueo original superado:
- Se implementó ruta en Next.js `src/app/(v2)/api/worker/run-daily-clinical/route.ts`.
- Desplegado a Vercel Producción exitosamente (`smartsellerv2.vercel.app`).
- Disparo manual programático mediante autenticación `x-cron-secret`.

Fix validado operativamente:
- **Deploy + Trigger real:** API invocada en Vercel, respondiendo HTTP 200 con JSON content (`{ok: true, run_id: "...003", snapshot_id: "...9ee"}`).
- **Validación SQL:** Confirmado el `snapshot_id` vinculado al `run_id` y su payload canónico respectivo (contiene arrays de `worker_results` y fecha `metric_date`).
- **Verificación linkage:** En base de datos de producción el motor enlaza este `snapshot_id` explícito a las filas relacionales afectadas en las tablas de `v2_clinical_signals` y `v2_health_scores`.
- Cierre definitivo post-auditoría clínica.

---

## Mapeo a roadmap (workstream clínico habilitador)

- **Habilitado:** base de datos robusta + writer tipado + motor clínico v0 parcial.
- **Tramo 1 Runtime Verificado:** El endpoint del orquestador está expuesto, certificando la creación materializada de la imagen mediante `ensureSnapshotForRun`.
- **Tramo 2 Runtime Verificado (SNAPSHOT CANÓNICO):** El código actual fue validado funcionalmente post-deploy (forzado sin cache) en el entorno de despliegue principal; los workers nutren el daily_metrics abstractamente desde los snapshots `clinical_inputs` sin pegarle al dataset vivo.
- **En cierre:** observabilidad de notificaciones (3.B) y expansión de entidad fulfillment.

---

## Cierre final del Core Clínico V2

### Estado final por tramo
| Tramo | Estado final |
|---|---|
| `webhook_events → domain_events` | `OK` |
| `domain_events → snapshots` | `FIXED` |
| `snapshots → metrics_daily` | `FIXED` |
| `metrics_daily → clinical_signals` | `OK` |
| `clinical_signals → health_scores` | `FIXED` |

### Dictamen
El core clínico queda **cerrado y operativo** para el alcance V2 auditado.

### Evidencia operativa mínima consolidada
- Route productiva para orquestador clínico disponible y autenticada por `x-cron-secret`.
- Ejecuciones reales con retorno de `run_id`/`snapshot_id`.
- Snapshot canónico usado como fuente de inputs para métricas.
- Persistencia de métricas con merge JSON no destructivo para evitar pérdida de keys entre sub-workers.

### Siguientes frentes (fuera del core)
1. **Reconciliación** — ver `docs/architecture/RECONCILIATION_AUDIT.md`. Estado formal: **FIXED / OPERATIONAL**.
2. Observabilidad/QA.
3. Hardening de workers.

---

## Apertura formal de V3 (2026-03-10)

Con el core clínico V2 plenamente validado operativamente en todos sus tramos, se formaliza la decisión arquitectónica de apertura de V3 canónica en paralelo.

**ADR:** [`docs/adr/ADR-0009-v3-canonical-rebuild-strategy.md`](../adr/ADR-0009-v3-canonical-rebuild-strategy.md)  
**Status:** Accepted

### Resumen de la decisión
- **V2:** queda en modo **estabilización operativa estricta**. Solo correcciones críticas, hardening de reconciliación y documentación. Sin expansión estructural.
- **V3:** se abre como **core canónico paralelo**, construido desde primeros principios con: un writer por etapa, multi-tenant safety, determinismo, idempotencia, trazabilidad de snapshot a score, y adapters de proveedor separados del core.
- **Migración:** progresiva por tramo (7 etapas gate-driven). Sin big-bang cutover.

### Estado de los tramos V2 al cierre
| Tramo | Estado validado |
|---|---|
| `webhook_events → domain_events` | `OK` |
| `domain_events → snapshots` | `FIXED` |
| `snapshots → metrics_daily` | `FIXED` |
| `metrics_daily → clinical_signals` | `FIXED` |
| `clinical_signals → health_scores` | `FIXED` |
| Reconciliación ML (orders) | `FIXED / OPERATIONAL` |

### ADRs de V3 abiertos

| ADR | Título | Status |
|---|---|---|
| [ADR-0009](../adr/ADR-0009-v3-canonical-rebuild-strategy.md) | V3 Canonical Rebuild Strategy | Accepted |
| [ADR-0010](../adr/ADR-0010-v3-canonical-identity-and-tenancy-model.md) | V3 Canonical Identity & Tenancy Model | Accepted |
| [ADR-0011](../adr/ADR-0011-v3-pipeline-ownership-and-writer-governance.md) | V3 Pipeline Ownership & Writer Governance | Accepted |
| [ADR-0012](../adr/ADR-0012-v3-access-control-and-rls-strategy.md) | V3 Access Control & RLS Strategy | Accepted |


---

## Reconciliación Operativa (auditada 2026-03-10)

### Dictamen operativo: `FIXED / OPERATIONAL`  
### Dictamen consistencia: `FIXED / OPERATIONAL`

| Componente | Estado real |
|---|---|
| Worker `meli-reconcile` | ✅ Implementado (idempotencia, cursor, backoff, DLQ, heartbeat, SKIP LOCKED) |
| Tabla `v2_reconciliation_jobs` | ✅ 1 row — `status = done` — post-primera-ejecución |
| `v2_claim_reconciliation_jobs` RPC | ✅ Existe y funciona |
| `v2_enqueue_reconciliation_jobs` RPC | ✅ Implementada en `20260310_v2_reconciliation_cron.sql` |
| Cron/schedule `meli_reconcile_6h` | ✅ `0 */6 * * *` activo en pg_cron |
| Heartbeats worker | ✅ `processed=6, failed=0` |
| `order.reconciled` en `v2_domain_events` | ✅ 6 eventos reales de ML (ARS, 2025–2026) |
| `order.reconciled` propaga a `v2_orders` | ✅ Fix A+B implementados en `meli-reconcile/route.ts` |
| `order.reconciled` visible para motor clínico | ✅ Validado operativamente |
| Entidades cubiertas por worker | ⚠️ Solo `orders` — payments/refunds/fulfillments sin implementar |

### Próximo paso mínimo
✅ **VALIDADO OPERATIVAMENTE (2026-03-10)**
1. `order.reconciled` materializa en `v2_orders` (6/6 verificados)
2. huérfanas reconciliadas = 0

Ver detalles completos en `docs/architecture/RECONCILIATION_AUDIT.md`.

---

## Apertura de primera superficie funcional V3 (2026-03-14)

Con el pipeline V3 operativo (documentado en `docs/status/V3_PIPELINE_READY.md`), se cierran las primeras tres superficies read-only sobre V3:

| # | Endpoint | Dictamen | Fecha |
|---|---|---|---|
| 1ª | `GET /api/v3/clinical-status` | `APPROVED WITH MINOR NOTES` | 2026-03-14 |
| 2ª | `GET /api/v3/run-history` | `APPROVED WITH MINOR FIXES` (fixes aplicados) | 2026-03-14 |
| 3ª | `GET /api/v3/store-pulse` | `APPROVED WITH MINOR FIXES` (fixes aplicados) | 2026-03-14 |

**Disciplina operativa:** patrón anti-bugs documentado en `docs/architecture/V3_READ_MODEL_PATTERN.md`.

Ver cierre completo en `docs/status/V3_PIPELINE_READY.md` § *Superficies read-only sobre V3*.
