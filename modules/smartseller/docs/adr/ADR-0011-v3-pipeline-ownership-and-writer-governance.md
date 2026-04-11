# ADR-0011 — V3 Pipeline Ownership and Writer Governance

- **Status:** Accepted
- **Date:** 2026-03-10
- **Owners:** SmartSeller Architecture
- **Decision Type:** Foundational / Irreversible without superseding ADR
- **Depends on:** ADR-0009, ADR-0010

---

## 1. Title

Define pipeline stage ownership and enforce a single governed writer per stage for SmartSeller V3.

---

## 2. Status

**Accepted.** Every V3 writer contract, RPC, orchestrator, and adapter must comply with this ADR. Violations constitute a breaking change to the clinical guarantee.

---

## 3. Context

SmartSeller's clinical guarantee rests on a deterministic, traceable pipeline:

```
webhook_events → domain_events → snapshots → metrics → clinical_signals → health_score
```

Each stage transforms data from the previous stage and materializes its output into a governed table. The correctness of clinical signals and health scores depends entirely on each stage being written once, by one component, under a consistent contract.

In V2, multiple writers competed over the same stages throughout the system's life:
- Snapshots were written by the orchestrator, by the score endpoint, and by legacy RPCs.
- Health scores were written by three different sub-workers independently.
- Metrics were merged via application-level read-modify-write, creating race conditions under Next.js memoization.
- Signal insertion had no governing owner; any worker could write signals under any key.

The result: forensic-level QA was required to confirm basic correctness. State was not reliably reconstructable from a snapshot. Fixes for one writer created bugs in another.

V3 must eliminate this class of failure by design, not by discipline.

---

## 4. Problem

**Multiple writers per stage break determinism.** If more than one component writes to a stage, the final state depends on execution order, timing, and race conditions, not on business logic.

**Ad hoc writes corrupt clinical state.** An endpoint that inserts a signal directly, without going through the governed writer, creates rows with unknown provenance, incomplete identity, and no guaranteed traceability.

**Adapter boundary violations poison the core.** If a provider adapter writes directly into `v3_snapshots` or `v3_health_scores`, the core becomes coupled to provider-specific timing, identity assumptions, and error modes.

**The consequence is not a bug. It is a systemic guarantee failure.** Clinical traceability, score reproducibility, and multi-tenant safety all collapse when writer governance is absent.

---

## 5. Decision

SmartSeller V3 enforces **one governed writer per pipeline stage**.

A governed writer is:
- Explicitly named and documented.
- Responsible for identity completeness at the point of write.
- Idempotent by deterministic key.
- The only component authorized to write to that stage's canonical table.

No other component may write to a canonical stage table directly.

---

## 6. Official Pipeline

```
webhook_events → domain_events → snapshots → metrics → clinical_signals → health_score
```

Each arrow represents a governed transformation with a single owning component.

---

## 7. Pipeline Stage Ownership

### Stage 1 — `v3_webhook_events`

| Field | Value |
|---|---|
| **Owner** | Provider Ingest Adapter (one per provider: ML, Shopify) |
| **Input** | Raw HTTP webhook payload from provider |
| **Output** | Stored raw event with `dedupe_key`, `provider_key`, `store_id`, `tenant_id` |
| **Idempotency Key** | `dedupe_key` (deterministic hash of provider event ID + provider_key) |
| **Prohibited** | Any other component writing to `v3_webhook_events` directly |

---

### Stage 2 — `v3_domain_events`

| Field | Value |
|---|---|
| **Owner** | Domain Event Normalizer (one per provider, governed pipeline step) |
| **Input** | `v3_webhook_events` rows with status `pending` |
| **Output** | Normalized `event_type`, `entity_id`, `entity_type`, full identity |
| **Idempotency Key** | `(source_event_id, store_id)` — unique constraint |
| **Prohibited** | Direct domain event inserts from business logic, scoring, or adapters |

---

### Stage 3 — `v3_snapshots`

| Field | Value |
|---|---|
| **Owner** | Clinical Orchestrator (one per run, seed phase + close phase) |
| **Input** | `run_id`, `tenant_id`, `store_id`, `metric_date`, computed `clinical_inputs` |
| **Output** | Immutable snapshot with `clinical_inputs` payload locked at seed time |
| **Idempotency Key** | `(tenant_id, store_id, run_id)` |
| **Prohibited** | Score endpoints, API handlers, adapters, or sub-workers writing snapshots independently |

---

### Stage 4 — `v3_metrics_daily`

| Field | Value |
|---|---|
| **Owner** | Metrics Writer (atomic merge RPC: `v3_upsert_metrics_daily_merge`) |
| **Input** | `clinical_inputs` from snapshot payload, `metric_date`, full identity |
| **Output** | JSONB metrics record per `(tenant_id, store_id, metric_date)` — merged atomically |
| **Idempotency Key** | `(tenant_id, store_id, metric_date)` — upsert with merge, not replace |
| **Prohibited** | Application-level read-modify-write patterns; direct table inserts bypassing the RPC |

---

### Stage 5 — `v3_clinical_signals`

| Field | Value |
|---|---|
| **Owner** | Clinical Signal Writer (called by each authorized worker, with full identity) |
| **Input** | Derived severity, `signal_key`, `evidence`, `run_id`, `snapshot_id`, full identity |
| **Output** | One signal row per `(run_id, signal_key)` |
| **Idempotency Key** | `(run_id, signal_key)` — enforced at DB level |
| **Prohibited** | Ad hoc signal inserts from API endpoints, score handlers, or adapters |

---

### Stage 6 — `v3_health_scores`

| Field | Value |
|---|---|
| **Owner** | Score Aggregator (single call at orchestrator close, after all signals are committed) |
| **Input** | All `v3_clinical_signals` for `run_id`, snapshot identity, full identity |
| **Output** | One health score per `(store_id, run_id)` — deterministically computed |
| **Idempotency Key** | `(store_id, run_id)` — upsert |
| **Prohibited** | Per-worker score writes; incremental score updates from individual sub-workers |

> **Critical change from V2:** In V2, each sub-worker independently upserted the score, creating a race condition and non-reproducible final value. In V3, score computation is a single aggregation step after all signals are present. No sub-worker may write to `v3_health_scores` directly.

---

## 8. The Single Governed Writer Rule

For every stage S in the canonical pipeline:

1. There is exactly **one governed writer** for S.
2. That writer holds the **complete identity** required by ADR-0010 at the point of write.
3. That writer is **idempotent**: re-running it with the same inputs produces the same state, with no side effects.
4. **No other component** may write to S's canonical table, regardless of convenience.
5. Exceptions require a superseding ADR with explicit rationale and governance.

This rule is not a preference. It is the structural guarantee that makes deterministic clinical scoring possible.

---

## 9. Prohibitions

The following patterns are **explicitly prohibited** in V3:

| Pattern | Why Prohibited |
|---|---|
| API endpoint inserting directly into `v3_clinical_signals` | Creates untracked signal rows with no run/snapshot linkage |
| Score endpoint writing to `v3_snapshots` | Snapshot must belong to an orchestrated run, not a read path |
| Sub-worker independently updating `v3_health_scores` | Score becomes non-reproducible; depends on worker execution order |
| Adapter writing directly into `v3_domain_events` | Domain normalization is a governed step; adapters only write to `v3_webhook_events` |
| Application-level read-modify-write on `v3_metrics_daily` | Creates race conditions under concurrent execution; atomic merge RPC is mandatory |
| Multiple orchestrators running concurrently for the same `(store_id, metric_date)` | Undefined state; idempotency key must prevent this at the DB level |
| `NULL` values for required identity fields at write time | Violates ADR-0010 invariants; writer must reject, not silently accept |

---

## 10. Idempotency and Reconstruction Rules

Every governed writer must satisfy:

1. **Re-execution safety:** running the writer twice with the same input must produce the same database state. No duplicate rows, no accumulation errors.
2. **Deterministic key:** the idempotency key must be derivable from inputs alone, not from timestamps or random values.
3. **State reconstructability:** given the contents of `v3_snapshots` for a given `run_id`, the system must be able to recompute `v3_metrics_daily`, `v3_clinical_signals`, and `v3_health_scores` to the same result.
4. **No hidden state:** writers must not depend on external runtime state that is not captured in the snapshot or the input to the pipeline stage.

---

## 11. Consequences

### Positive
- Eliminates race conditions and non-deterministic final state in the clinical pipeline.
- Score is reproducible: given a snapshot, the same score must result every time.
- Forensic validation is routine, not exceptional: ownership is clear, writes are auditable.
- Onboarding a new provider does not risk corrupting existing pipeline stages.
- Workers can be safely retried, replayed, or parallelized without state corruption.

### Negative
- Initially slower to implement: each writer must be explicitly designed and approved.
- Sub-workers cannot "shortcut" to the score; they must go through the aggregation step.
- Existing V2 patterns that bypass this governance must be identified and eliminated before migration of each stage.

---

## 12. Impact on Workers, RPCs, and Adapters

### Workers (Sub-clinical units: refunds, payments, zero_price)
- Authorized scope: compute metric value from snapshot input, insert signal via governed writer.
- **Not authorized:** write to `v3_health_scores` directly.
- Score contribution is communicated via the signal's `severity` — the Score Aggregator reads all signals and computes the final score.

### RPCs (Database functions)
- `v3_upsert_metrics_daily_merge`: the only authorized writer for `v3_metrics_daily`. Called by the Metrics Writer.
- `v3_run_engine_for_store` (legacy V2 pattern): in V3, this RPC's scope is eliminated. Each responsibility is owned by a discrete pipeline stage.
- Any new RPC that writes to a canonical table must be explicitly named in an ADR or a V3 writer contract document.

### Adapters (ML, Shopify)
- Authorized to write: `v3_webhook_events` only.
- Must resolve `tenant_id`, `store_id`, and `provider_key` before writing.
- Must not call the Domain Normalizer, Snapshot Writer, or any downstream stage directly.
- The pipeline picks up from `v3_webhook_events` autonomously after adapter write.

---

## Related ADRs

- ADR-0009: V3 Canonical Rebuild Strategy *(prerequisite)*
- ADR-0010: V3 Canonical Identity and Tenancy Model *(prerequisite)*
