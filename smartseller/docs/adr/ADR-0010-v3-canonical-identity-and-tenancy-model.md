# ADR-0010 — V3 Canonical Identity and Tenancy Model

- **Status:** Accepted
- **Date:** 2026-03-10
- **Owners:** SmartSeller Architecture
- **Decision Type:** Foundational / Irreversible without superseding ADR
- **Depends on:** ADR-0009 (V3 Canonical Rebuild Strategy)

---

## 1. Title

Define the canonical, non-negotiable identity and tenancy model for SmartSeller V3.

---

## 2. Status

**Accepted.** This ADR is binding for all V3 schema design, writer contracts, and adapter boundaries. No V3 table, writer, or migration may bypass this model.

---

## 3. Context

SmartSeller operates as a multi-tenant clinical risk system. Every piece of data it materializes—events, snapshots, metrics, signals, scores—belongs to a specific seller, operating under a specific tenant, connected via a specific provider.

In V2, identity gaps accumulated:
- Some rows were written without `tenant_id`.
- `snapshot_id` and `run_id` linkage was partial in legacy paths.
- `external_id` from provider APIs was sometimes conflated with internal identity.
- Provider-specific fields leaked into tables that should have been provider-agnostic.

These gaps caused:
- forensic validation burden instead of routine QA;
- cross-tenant confusion risk under concurrent writes;
- inability to deterministically reconstruct clinical state from a snapshot.

V3 must be immune to these failure modes from the first schema design.

---

## 4. Problem

**Without a strict, explicit, enforced identity model:**

- Clinical traceability breaks. A signal or score cannot be reliably attributed to a specific seller, run, or event.
- Multi-tenant safety fails. Row-level isolation cannot be enforced if `tenant_id` is nullable or absent.
- Forensic auditability is impossible. State reconstruction requires complete identity at every layer.
- Provider coupling poisons the core. If `external_id` or provider-specific columns become primary identity, migrating or adding channels becomes structurally impossible.

**Identity is not a detail. It is the foundation of the clinical guarantee.**

---

## 5. Decision

SmartSeller V3 adopts a **canonical identity model** that is uniform, explicit, and non-nullable across all core tables.

Every V3 core table carries the full identity required by its position in the pipeline. No exceptions. No nullables in production rows.

---

## 6. Mandatory Identity Entities

### `tenant_id` (UUID)
- Internal identifier for the business entity (company, user, or account root).
- Root of all row-level isolation.
- **Never derived from provider data.** Assigned at onboarding, stored in `v3_tenants`.
- Present in: every core table, no exceptions.

### `store_id` (UUID)
- Internal identifier for a specific store or channel connection.
- A tenant may have multiple stores (e.g., one ML account + one Shopify store).
- Assigned at store creation, stored in `v3_stores`.
- Present in: every core table, no exceptions.

### `seller_uuid` (UUID)
- Stable internal identifier for the seller entity, independent of provider.
- Provides identity continuity if a provider account changes or is re-linked.
- Stored in `v3_sellers`.
- Present in: identity layer, store linkage, optional in operational tables where derived via `store_id`.

### `external_id` (text)
- Provider-assigned identifier (e.g., ML seller ID, Shopify shop domain).
- Used only for API communication and deduplication against provider data.
- **Never replaces `tenant_id`, `store_id`, or `seller_uuid` as internal identity.**
- Stored in provider extension tables (`v3_ml_accounts`, `v3_shopify_installations`), not in core tables.

### `provider_key` (text enum)
- Identifies the integration channel: `mercadolibre`, `shopify`, `system`.
- Always explicit. Never inferred at runtime.
- Present in: `v3_webhook_events`, `v3_domain_events`, `v3_snapshots`, and any table that originates from a provider source.
- Value `system` is reserved for internal orchestrator-generated rows.

---

## 7. Separation Rules

### Rule 1: `external_id` never replaces internal identity
`external_id` is a lookup key for API calls and deduplication. It is not a primary key, not a tenant identifier, and not safe to use as a join key across tables. Core joins always use `tenant_id` + `store_id` + internal UUIDs.

### Rule 2: `provider_key` always explicit
No row in a provider-facing table may exist without an explicit `provider_key`. There is no default. `provider_key = 'system'` is the only internal default and must be used intentionally.

### Rule 3: Full identity per table tier

| Table Tier | Required Identity Fields |
|---|---|
| Core identity (`tenants`, `stores`, `sellers`) | `tenant_id`, `store_id`, `seller_uuid` |
| Ingest (`webhook_events`, `domain_events`) | `tenant_id`, `store_id`, `provider_key`, `external_id` |
| Engine (`engine_runs`, `snapshots`) | `tenant_id`, `store_id`, `run_id` |
| Metrics & Signals (`metrics_daily`, `clinical_signals`) | `tenant_id`, `store_id`, `run_id`, `snapshot_id` |
| Scores (`health_scores`) | `tenant_id`, `store_id`, `run_id`, `snapshot_id` |
| Provider extensions | `tenant_id`, `store_id`, `provider_key`, `external_id` |

### Rule 4: No cross-tenant reads
No query, RPC, or function may return rows belonging to more than one `tenant_id` at a time. Row-level security (RLS) must enforce this at the database layer.

---

## 8. Multi-Tenant Rules

1. **Isolation is mandatory at the DB layer.** RLS policies must enforce `tenant_id` isolation on all core tables. Application-level filtering is not sufficient.
2. **Onboarding assigns identity.** `tenant_id` and `store_id` are assigned during tenant/store creation, never during data ingestion.
3. **No tenant zero.** There is no "global" or "default" tenant. Every row must belong to a real, registered tenant.
4. **Backfills respect tenancy.** Any historical data migration must carry and validate `tenant_id` and `store_id` before insertion.
5. **Concurrent writes are safe by design.** Identity-complete rows allow correct upsert deduplication without cross-tenant collision risk.

---

## 9. Non-Negotiable Invariants

These invariants must hold at all times in V3 production:

| # | Invariant |
|---|---|
| I-1 | Every production row in a core table has a non-null `tenant_id`. |
| I-2 | Every production row in a core table has a non-null `store_id`. |
| I-3 | Every `webhook_event` and `domain_event` has a non-null `provider_key`. |
| I-4 | Every `snapshot`, `clinical_signal`, and `health_score` has a non-null `run_id`. |
| I-5 | Every `clinical_signal` and `health_score` has a non-null `snapshot_id` at write time or linked within the same transaction. |
| I-6 | `external_id` never appears in core pipeline tables (`engine_runs`, `snapshots`, `metrics_daily`, `clinical_signals`, `health_scores`). |
| I-7 | No two tenants share identity-scoped keys without an explicit multi-tenant join design. |

Any schema migration, writer, or adapter that would violate an invariant must first supersede this ADR.

---

## 10. Consequences

### Positive
- Eliminates the class of bugs where signals or scores are written without traceable identity.
- Row-level isolation becomes enforceable, not just aspirational.
- State reconstruction from a snapshot is guaranteeable: all required identity fields are present.
- Adding a new provider (Shopify or others) does not touch or risk core identity.
- Clinical score attribution is deterministic and auditable.

### Negative
- Every V3 writer must carry and validate identity at the call site — no shortcuts.
- Onboarding flows must provision `tenant_id` and `store_id` before any operational data is written.
- RLS enforcement adds overhead that must be accounted for in query design.
- Backfill scripts require identity validation before execution.

---

## 11. Impact on Provider Adapters

### Mercado Libre Adapter
- `ml_seller_id`, `ml_site_id`, and other ML-specific fields live in `v3_ml_accounts` and `v3_ml_listings`, never in core tables.
- ML webhook ingestion must resolve `store_id` from `external_id` before writing to `v3_webhook_events`.
- `provider_key = 'mercadolibre'` must be present in every ML-originated row.

### Shopify Adapter
- `shop_domain`, `shopify_order_id`, and similar fields live in `v3_shopify_installations` and extension tables.
- Shopify webhook ingestion must resolve `store_id` at ingest time, not deferred.
- `provider_key = 'shopify'` must be present in every Shopify-originated row.
- Offline token storage and installation state live in the Shopify adapter layer, completely isolated from core.

### General Adapter Rule
No adapter may call a core writer without having already resolved `tenant_id`, `store_id`, and `provider_key`. Identity resolution is the adapter's responsibility, not the core pipeline's.

---

## Related ADRs

- ADR-0009: V3 Canonical Rebuild Strategy *(prerequisite)*
- ADR-0004: Domain Event Cardinality
- ADR-0003: Session Model
