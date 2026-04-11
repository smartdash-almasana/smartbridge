# ADR-0013: V3 Identity Bridge Through Explicit V2 Mapping

- Status: Accepted (Freeze Oleada 1)
- Date: 2026-03-21
- Owners: V3 Recovery / DB Integrity

## Decision

While OAuth ownership remains in V2, V3 identity resolution for Mercado Libre uses an explicit bridge table:

- `public.v3_store_v2_bridge`
- key: `(provider_key, external_account_id)`
- target: canonical `(tenant_id, store_id)` in V3

`resolveV3MeliIdentity` now resolves in this order:
1. `v3_stores` direct mapping (`store_key = external_account_id`)
2. `v3_store_v2_bridge` explicit mapping
3. fail closed

## Why

- Removes hidden inline dependency on `v2_stores` lookups inside runtime ingestion.
- Makes V2 dependency explicit, auditable, and reversible.
- Keeps deterministic V3 write path while OAuth migration is incomplete.

## Scope / Constraints

- Temporary bridge only. No OAuth redesign in this ADR.
- No UI or handler contract change.
- No dual-write behavior change.

## Rollout Notes

- Migration backfills bridge rows from `v2_stores` only when a matching `(tenant_id, store_id)` exists in `v3_stores`.
- Missing bridge rows now fail closed during ingestion with explicit error text.

## Exit Criteria

Bridge can be removed when OAuth and identity source of truth are fully owned by V3 and `v3_stores` contains complete production mapping.
