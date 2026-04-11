# V2 Score V0 — Plan de Implementación
**Fecha:** 2026-02-26 15:30:00 | **Proyecto:** SmartSeller V2

---

## 1. Inventario de Eventos (DB actual)

> **Estado:** DB en fase bootstrap mínima. Solo 1 evento real registrado.

| event_type | entity_type | count | Tópico webhook |
|---|---|---|---|
| `order.updated` | order | 1 | `orders_v2` |

**Vocabulario Mercado Libre esperado** (según pipeline ingest → normalize):

| event_type | topic ML |
|---|---|
| `order.created` / `order.updated` | `orders_v2` |
| `order.cancelled` | `orders_v2` |
| `message.received` | `messages` |
| `message.answered` | `messages` |
| `claim.opened` | `claims` |
| `reputation.updated` | `seller_metrics` |
| `shipment.updated` | `shipments` |

> **Nota de honestidad:** Los 5 event_types del plan son proyectados desde el vocabulario ML canónico. La DB los recibirá a medida que el pipeline Ingest→Normalize procese webhooks reales.

---

## 2. Métricas Mínimas (v2_metrics_daily.metrics JSONB)

5 métricas derivables desde `v2_domain_events` por `(store_id, DATE(occurred_at))`:

| Métrica | Clave JSONB | Derivación SQL |
|---|---|---|
| Órdenes creadas en el día | `orders_created_1d` | `COUNT(*) FILTER (WHERE event_type = 'order.created')` |
| Órdenes canceladas | `orders_cancelled_1d` | `COUNT(*) FILTER (WHERE event_type = 'order.cancelled')` |
| Mensajes recibidos | `messages_received_1d` | `COUNT(*) FILTER (WHERE event_type = 'message.received')` |
| Mensajes respondidos | `messages_answered_1d` | `COUNT(*) FILTER (WHERE event_type = 'message.answered')` |
| Reclamos abiertos | `claims_opened_1d` | `COUNT(*) FILTER (WHERE event_type = 'claim.opened')` |

**SQL de agregación (por store_id, metric_date):**
```sql
SELECT
  store_id,
  DATE(occurred_at)                                                              AS metric_date,
  COUNT(*) FILTER (WHERE event_type = 'order.created')                          AS orders_created_1d,
  COUNT(*) FILTER (WHERE event_type = 'order.cancelled')                        AS orders_cancelled_1d,
  COUNT(*) FILTER (WHERE event_type = 'message.received')                       AS messages_received_1d,
  COUNT(*) FILTER (WHERE event_type = 'message.answered')                       AS messages_answered_1d,
  COUNT(*) FILTER (WHERE event_type = 'claim.opened')                           AS claims_opened_1d
FROM v2_domain_events
WHERE store_id = $1
  AND occurred_at >= NOW() - INTERVAL '30 days'
GROUP BY store_id, DATE(occurred_at);
```

---

## 3. Señales Mínimas (v2_clinical_signals)

5 señales, evaluadas sobre métricas de los últimos 7/14 días:

| signal_key | Condición | Severidad | Evidencia mínima |
|---|---|---|---|
| `no_orders_7d` | SUM(orders_created_1d) = 0 en últimos 7 días | `high` | 0 rows con event_type='order.created' en 7d |
| `cancellation_spike` | orders_cancelled_1d / MAX(orders_created_1d, 1) > 0.3 | `high` | Ratio cancel/created > 30% en el día |
| `unanswered_messages_spike` | messages_received_1d > 5 AND messages_answered_1d = 0 | `high` | received>5 sin answered el mismo día |
| `claims_opened` | SUM(claims_opened_1d) > 0 en últimos 14 días | `medium` | Al menos 1 claim.opened en 14d |
| `low_activity_14d` | SUM(orders_created_1d + messages_received_1d) < 3 en últimos 14 días | `low` | Actividad total < 3 eventos en 14d |

---

## 4. Score V0 — Fórmula Determinista

**Base score:** 100 (máximo sano)

**Penalizaciones por señales activas (aditivas):**

| Signal activa | Penalización |
|---|---|
| `no_orders_7d` | -40 |
| `cancellation_spike` | -25 |
| `unanswered_messages_spike` | -20 |
| `claims_opened` | -10 |
| `low_activity_14d` | -5 |

**Fórmula:**
```
score_v0 = MAX(0, 100 - SUM(penalizaciones de señales activas))
```

**Rango:** 0–100. Score=0 solo si `no_orders_7d` + `cancellation_spike` + `unanswered_messages_spike` están activas simultáneamente.

**Sin dependencias externas.** Solo queries sobre `v2_domain_events` y `v2_metrics_daily`.

---

## 5. Plan de Implementación (3 pasos)

### Paso 1 — Calcular métricas en `GET /api/score/[store_id]`
- **Dónde:** `src/v2/api/score.ts` → función `computeScoreV0(storeId)`.
- **Qué hace:** Agrega `v2_domain_events` por store_id en ventana 14d → deriva 5 métricas.
- **Persistir:** Upsert en `v2_metrics_daily` (tenant_id, store_id, metric_date, metrics jsonb).

### Paso 2 — Evaluar señales
- **Dónde:** `src/v2/api/score.ts` → función `evaluateSignals(metrics[])`.
- **Qué hace:** Evalúa las 5 condiciones sobre métricas → genera señales activas.
- **Persistir:** Insert en `v2_clinical_signals` (signal_key, severity, evidence jsonb, store_id, run_id).

### Paso 3 — Calcular y persistir score
- **Dónde:** `src/v2/api/score.ts` → función `persistScore(storeId, signals)`.
- **Qué hace:** Aplica fórmula de penalizaciones → calcula score (0–100).
- **Persistir:** Upsert en `v2_health_scores` (store_id, score, computed_at, run_id, snapshot_id).
- **Snapshot:** Insert en `v2_snapshots` con payload = métricas + señales + score (evidencia auditada).

### Flujo canónico completo:
```
GET /api/score/[store_id]
  │
  ├─► computeScoreV0(storeId)    → agrega v2_domain_events → upsert v2_metrics_daily
  ├─► evaluateSignals(metrics)    → evalúa condiciones     → insert v2_clinical_signals
  ├─► persistScore(signals)       → calcula score          → upsert v2_health_scores
  └─► createSnapshot(payload)     → evidencia auditada     → insert v2_snapshots
```

> **Nota:** El endpoint actual (`src/v2/api/score.ts`) solo *lee* `v2_health_scores`. El refactor mínimo es agregar `computeScoreV0()` que genere un score calculado on-demand si no existe score reciente (ej: `computed_at < NOW() - INTERVAL '1 hour'`), y retornarlo junto con el score persistido.

---

## Estado Actual

| Componente | Estado |
|---|---|
| `v2_webhook_events` | ✅ Tiene columna tenant_id, dedupe_key, índices |
| `v2_domain_events` | ✅ Tiene store_id, tenant_id (backfilled) |
| `v2_clinical_signals` | ✅ RLS activo, 1 señal de prueba |
| `v2_health_scores` | ✅ RLS activo, score=0 por defecto |
| `v2_snapshots` | ✅ Tabla creada, sin filas |
| `v2_metrics_daily` | ✅ Tabla creada, sin filas |
| `src/v2/api/score.ts` | ⚠️ Solo lee score existente; no calcula |
| Fórmula V0 | 📋 Este documento (pendiente de implementar) |

Related: see contract [docs/V2_SCORE_V0_CONTRACT.md](./V2_SCORE_V0_CONTRACT.md).
