# ADR-0009 — Canonical Rebuild Strategy: V2 Stabilization + Parallel V3

- **Status:** Accepted
- **Date:** 2026-03-10
- **Owners:** SmartSeller Architecture
- **Decision Type:** Structural / Supersedes implicit ongoing V2 expansion

---

## 1. Title

Open a parallel V3 canonical core while keeping V2 in strict operational stabilization mode.

---

## 2. Status

**Accepted.** This ADR is binding. No structural expansion of V2 is permitted without a superseding ADR.

---

## 3. Context

SmartSeller is a clinical operative risk system for marketplace sellers, not a reporting dashboard. Its core purpose is to deterministically detect operational, reputational, and financial damage before it materializes.

After months of work on V2, the following structural signals are now clearly present:

- Multiple active writers exist in critical pipeline stages (`v2_snapshots`, `v2_health_scores`).
- There is persistent overlap between legacy data flows and canonical flows, requiring forensic validation instead of routine QA.
- The repeated need for reconciliation audits, memoization fixes, and idempotency guards signals a systemic architecture problem, not isolated defects.
- Cognitive cost to explain and validate end-to-end behavior is growing, not shrinking.
- Shopify integration pressure (second planned channel) risks driving more provider-specific fields into the core if V2 is extended as-is.

V2 is not disposable. Key pipeline stages are now operationally validated:
- `domain_events → snapshots`: **FIXED**
- `snapshots → metrics_daily`: **FIXED** (atomic RPC)
- `metrics_daily → clinical_signals`: **FIXED**
- `clinical_signals → health_scores`: **FIXED**

Production continuity must be maintained. A big-bang rewrite is explicitly rejected.

---

## 4. Decision

SmartSeller adopts a **dual-track strategy**:

### Track A — V2: Operational Stabilization Only
V2 is frozen structurally. Only the following work is authorized:
- Critical production fixes.
- Integrity and idempotency hardening.
- Reconciliation validation (orders, payments, refunds, fulfillments).
- Minimal operational documentation.
- No new domain complexity. No structural expansion.

### Track B — V3: Canonical Rebuild (Parallel)
A new V3 core is opened in parallel, built from first principles:
- Provider-agnostic core tables and pipeline.
- One governed writer per stage, no exceptions.
- Progressive migration by pipeline stage.
- No big-bang cutover. V2 and V3 may coexist during transition.

---

## 5. Rationale

Continued patching of V2 carries diminishing returns and increasing systemic risk:
- Each fix reveals another structural gap.
- Multiple writers per stage increase verification surface.
- Provider-specific fields leaking into core tables would permanently degrade the architecture.

A full immediate rewrite is also rejected:
- Delivery risk is unacceptable without progressive validation.
- Live production data must not be put at risk by an untested migration.

A parallel canonical V3 rebuild provides the optimal balance:
- **Continuity:** V2 runs while V3 is built.
- **Correction:** V3 is architected correctly from inception.
- **Control:** Migration is staged, ADR-governed, and reversible at each stage.
- **Scalability:** V3 can absorb Shopify and future channels without structural compromise.

---

## 6. Scope of V2 (Allowed Work)

| Permitted | Not Permitted |
|---|---|
| Critical production bugs | New domain entities without ADR |
| Idempotency hardening | Shopify core integration |
| Reconciliation fixes (ML orders, payments, fulfillments) | Structural expansion of pipeline |
| Operational validation documentation | Provider-driven schema changes to core |
| Minimal monitoring/observability patches | Feature development on top of V2 |

---

## 7. Scope of V3 (Foundation Rules)

V3 is built around the canonical pipeline:

```
webhook_events → domain_events → snapshots → metrics → clinical_signals → health_score
```

V3 core invariants (non-negotiable):

- **Multi-tenant safety:** every row carries `tenant_id`, `store_id`, `provider_key`.
- **Deterministic reconstruction:** given the same event log, the system must produce the same state.
- **One governed writer per stage:** no ambiguity about what creates or updates each table.
- **Provider isolation:** ML-specific and Shopify-specific fields live in extension tables, never in core.
- **Idempotent materialization:** inserts/upserts by deterministic keys; no accidental duplicates.
- **Reproducible scoring:** health scores must be derivable from snapshot content alone, no runtime magic.
- **Drift resilience:** reconciliation must be a first-class design concern, not a fix-on-demand.

---

## 8. Non-Negotiable Rules

1. No V3 table receives data from a V2 writer until a formal cutover ADR is accepted.
2. No V3 decision that affects core identity or pipeline ownership is taken without an ADR.
3. No provider adapter (ML, Shopify) modifies core V3 tables directly.
4. No `snapshot_id`, `run_id`, or `tenant_id` may be nullable in production rows after the identity stage is migrated.
5. No big-bang migration. Every stage must pass a gate before the next stage begins.

---

## 9. Migration Strategy

Migration is progressive and gate-driven. Recommended order:

| Stage | Scope | Gate Condition |
|---|---|---|
| 1. Identity & Tenancy | `tenants`, `stores`, `seller_identity` | Schema stable, all writers compliant |
| 2. Ingest Layer | `webhook_events`, `domain_events` | Idempotent ingest validated operationally |
| 3. Snapshots | `snapshots`, `engine_runs` | One writer, traceability confirmed |
| 4. Metrics | `metrics_daily` | Atomic merge pattern, no race conditions |
| 5. Clinical Signals | `clinical_signals` | Full identity linkage, no nulls |
| 6. Health Scores | `health_scores` | Deterministic derivation, reproducibility confirmed |
| 7. Provider Extensions | ML, Shopify adapters | Adapters isolated; core untouched |

Each stage goes through: **Design → ADR → Implementation → Operational Validation → Gate.**

---

## 10. Consequences

### Positive
- Eliminates the systemic brittleness accumulated in V2.
- Prevents Shopify from shaping the clinical core incorrectly.
- Reduces long-term QA and forensic burden.
- Creates a clean, formally governed foundation for deterministic clinical scoring.
- Enables confident multi-channel expansion.

### Negative
- Temporary dual maintenance cost (V2 stabilization + V3 construction).
- Requires upfront disciplined design before writing code.
- Migration governance becomes mandatory overhead with no shortcuts.

---

## 11. Go / No-Go Criteria

This ADR is **go** because the following conditions are present in V2 today (2026-03-10):

- [x] Critical pipeline stages had or have more than one active writer.
- [x] Validation cost is forensic, not routine.
- [x] Structural ambiguity persists between legacy and active flows.
- [x] Future integrations (Shopify) risk inheriting accidental V2 complexity.
- [x] The operational value of V2 is confirmed, justifying a controlled parallel track rather than abandonment.

**No-Go signal:** if all of the above conditions materially disappear in V2, this ADR may be revisited by a superseding ADR with explicit evidence.

---

## Related ADRs

- ADR-0003: Session model
- ADR-0004: Domain event cardinality
- ADR-0005: Ingest observability
- ADR-0006: DLQ reprocessor
- ADR-0007: Cron run auditing
- ADR-0008: *(draft; superseded and canonicalized by this ADR)*
