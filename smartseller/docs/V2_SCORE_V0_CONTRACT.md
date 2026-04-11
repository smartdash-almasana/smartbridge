# SmartSeller V2 - Score V0 Contract

## 1) Purpose & Invariants
- Definir contrato tecnico/funcional de Score V0.
- Determinismo: calcular solo desde DB.
- No APIs externas en scoring.
- Seguridad multi-tenant por `tenant_id`, `store_id`, `seller_uuid`, `external_account_id`, `provider_key`.
- Trazabilidad completa por `run_id` y `snapshot_id`.

## 2) Event Vocabulary (`domain_events.event_type`)
Eventos soportados V0:
- `order.created`
- `order.cancelled`
- `message.received`
- `message.answered`
- `claim.opened`

Placeholder mapping desde topics ML (sin prometer exactitud):
- `orders.created` -> `order.created`
- `orders.cancelled` -> `order.cancelled`
- `messages.received` -> `message.received`
- `messages.answered` -> `message.answered`
- `claims.opened` -> `claim.opened`

## 3) Metrics Contract (`v2_metrics_daily.metrics` jsonb)
- Tipo: `jsonb`.
- Keys (int):
  - `orders_created_1d`
  - `orders_cancelled_1d`
  - `messages_received_1d`
  - `messages_answered_1d`
  - `claims_opened_1d`
- Bucket: UTC diario (`day_utc`).
- Upsert identity: (`tenant_id`, `store_id`, `seller_uuid`, `provider_key`, `day_utc`).

## 4) Signal Contract (`v2_clinical_signals`)
- `signal_key`
- `severity` (`low|medium|high`)
- `active`
- `penalty`
- `evidence` (`jsonb`)
- `run_id`
- `snapshot_id`

## 5) Rules (exactas)
- `no_orders_7d`: active if `orders_created_7d==0`, penalty `40`.
- `cancellation_spike`: active if `orders_created_7d>0 AND orders_cancelled_7d>=max(3, ceil(created*0.30))`, penalty `25`.
- `unanswered_messages_spike`: `pending=received-answered`; active if `pending>=5`, penalty `20`.
- `claims_opened`: active if `claims_opened_7d>=1`, penalty `10`.
- `low_activity_14d`: `activity14=orders_created_14d + messages_received_14d + claims_opened_14d`; active if `0 < activity14 < 3`, penalty `5`.

Score:
- `score = clamp(100 - sum(penalidades activas), 0..100)`

## 6) Snapshot Payload Schema (`v2_snapshots.payload`)
Ejemplo JSON compacto:
```json
{
  "version": "score_v0",
  "computed_at": "2026-02-26T18:05:00Z",
  "metrics_daily_today": {
    "orders_created_1d": 1,
    "orders_cancelled_1d": 0,
    "messages_received_1d": 2,
    "messages_answered_1d": 1,
    "claims_opened_1d": 0
  },
  "aggregates": {
    "orders_created_7d": 4,
    "orders_cancelled_7d": 2,
    "messages_received_7d": 11,
    "messages_answered_7d": 5,
    "claims_opened_7d": 1,
    "orders_created_14d": 6,
    "messages_received_14d": 17,
    "claims_opened_14d": 1
  },
  "signals": [
    {"signal_key": "no_orders_7d", "severity": "high", "active": false, "penalty": 40, "evidence": {"orders_created_7d": 4}},
    {"signal_key": "cancellation_spike", "severity": "medium", "active": false, "penalty": 25, "evidence": {"orders_created_7d": 4, "orders_cancelled_7d": 2, "threshold": 3}},
    {"signal_key": "unanswered_messages_spike", "severity": "medium", "active": true, "penalty": 20, "evidence": {"received": 11, "answered": 5, "pending": 6}},
    {"signal_key": "claims_opened", "severity": "low", "active": true, "penalty": 10, "evidence": {"claims_opened_7d": 1}},
    {"signal_key": "low_activity_14d", "severity": "low", "active": false, "penalty": 5, "evidence": {"activity14": 24}}
  ],
  "score": {
    "base": 100,
    "penalty_total": 30,
    "value": 70
  }
}
```

## 7) Recompute Gate (1h) + Idempotencia y trazabilidad
- Recompute gate: si `computed_at >= now()-1h`, retornar ultimo score persistido.
- Si `computed_at < now()-1h`, recalcular.
- Idempotencia: unicidad operacional por `store_id + run_id`.
- Trazabilidad: `health_scores` y `clinical_signals` deben guardar `run_id` y `snapshot_id`.

## 8) Audit Queries
```sql
-- Q1: ultimo health score por store
select id, tenant_id, store_id, score, run_id, snapshot_id, computed_at
from v2_health_scores
where tenant_id = :tenant_id and store_id = :store_id
order by computed_at desc
limit 20;

-- Q2: snapshots recientes con payload
select id, tenant_id, store_id, run_id, created_at, payload
from v2_snapshots
where tenant_id = :tenant_id and store_id = :store_id
order by created_at desc
limit 20;

-- Q3: senales clinicas por run
select id, tenant_id, store_id, run_id, snapshot_id, signal_key, severity, active, penalty, evidence, created_at
from v2_clinical_signals
where tenant_id = :tenant_id and store_id = :store_id
order by created_at desc
limit 100;

-- Q4: metrics daily para ventanas 14d
select tenant_id, store_id, seller_uuid, provider_key, day_utc, metrics
from v2_metrics_daily
where tenant_id = :tenant_id
  and store_id = :store_id
  and day_utc >= (current_date - interval '14 day')
order by day_utc desc;
```

## 9) Non-goals
- refunds
- payments
- fulfillment
- reputation/ML avanzado
- scoring no determinista
- uso de APIs externas para alterar score runtime
