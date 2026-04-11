# Clinical Engine V0 Status

Fecha de corte: 2026-03-03

## Orquestación y workers
- Orquestador: `src/v2/engine/run-daily-clinical-v0.ts`
- Workers:
  - `src/v2/engine/refund-metrics-worker.ts`
  - `src/v2/engine/payments-unlinked-worker.ts`
  - `src/v2/engine/zero-price-items-worker.ts`

## Señales V0 activas
- `refund_spike_24h`
- `payments_without_orders_24h` (SKIP cuando N=0)
- `zero_price_items_24h`

## Idempotencia por run (A5)
- Early return en orquestador si el `run_id` del día ya tiene señales.
- Guard por worker: chequeo `signal_key` + `run_id` antes de insertar señal.
- Resultado operativo: sin doble-penalty en re-ejecuciones del mismo run.

## Ejemplo de output JSON (placeholder)
```json
{
  "success": true,
  "run_id": "00000000-0000-0000-0000-000000000000",
  "results": {
    "refunds": {"signal_key": "refund_spike_24h", "status": "ok"},
    "payments": {"signal_key": "payments_without_orders_24h", "status": "skipped"},
    "zero_price": {"signal_key": "zero_price_items_24h", "status": "ok"}
  },
  "score_final": 90
}
```
