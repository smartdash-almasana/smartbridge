# Typed Writer Status (V1)

Fecha de corte: 2026-03-03

## Estado de entidades materializadas
- `v2_orders`: **Materializada**
- `v2_order_items`: **Materializada**
- `v2_payments`: **Materializada**
- `v2_refunds`: **Materializada**
- `v2_fulfillments`: **Pendiente / no confirmado para feed productivo actual**

## DLQ y gate
- DLQ tipada: `v2_dlq_events` (validada en gate W0).
- Gate typed writer: `docs/qa/QA_TYPED_WRITER_GATE.sql`.
- Resultado reportado: **16/16 PASS** (2026-03-03).

## Implementación TS (paths exactos)
- `src/v2/typed-writer/orders-writer.ts`
- `src/v2/typed-writer/order-items-writer.ts`
- `src/v2/typed-writer/payments-writer.ts`
- `src/v2/typed-writer/refunds-writer.ts`

## Wiring en ingest worker
- Import y uso desde `src/v2/ingest/webhook-to-domain-worker.ts`:
  - `writeOrderFromDomainEvent`
  - `writePaymentFromDomainEvent`
  - `writeRefundFromDomainEvent`
