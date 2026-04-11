# ADR-0012 — V3 Access Control and RLS Strategy

- **Status:** Accepted
- **Date:** 2026-03-10
- **Owners:** SmartSeller Architecture
- **Decision Type:** Foundational / Security / Required before any ingest path goes live
- **Depends on:** ADR-0009, ADR-0010, ADR-0011

---

## 1. Title

Define the multi-tenant access control and Row Level Security (RLS) enforcement model for SmartSeller V3.

---

## 2. Status

**Accepted.** No V3 table may process live data from production adapters or real tenants until the RLS policies defined in this ADR are applied and verified.

---

## 3. Context

SmartSeller V3 is a multi-tenant system. The canonical identity model (ADR-0010) defines that every row carries `tenant_id` as the root of isolation. The schema has been materialized (DDL gate passed). The next step is enforcement.

Schema-level identity is necessary but not sufficient for multi-tenant safety. Without Row Level Security policies enforced at the database layer, the following conditions exist:

- A malformed query or misconfigured worker could read or write rows belonging to a different tenant.
- Application-level filtering (`WHERE tenant_id = X`) is the only barrier, and it is bypassable by bugs, bad joins, or direct DB access.
- A compromised adapter or misconfigured service role key can cross tenant boundaries without any DB-level resistance.

V2 did not enforce RLS. The risk was acceptable for a single-seller prototype. It is not acceptable for V3, which targets multi-tenant commercial environments from inception.

---

## 4. Problem

**Without RLS:**

- Multi-tenant isolation is aspirational, not structural. It depends entirely on application correctness.
- Any bug in a query, RPC, or worker that omits the `tenant_id` filter can silently return or mutate another tenant's clinical data.
- Compliance obligations (data privacy) cannot be met if the DB does not enforce row-level access bounds.
- The clinical guarantee of SmartSeller — that a health score belongs to a specific, unambiguous tenant — collapses if rows can bleed across tenants.

**A V3 system without RLS is not multi-tenant. It is multi-user with shared data and a naming convention.**

---

## 5. Decision

SmartSeller V3 enforces **Row Level Security on all core tables** as a non-negotiable prerequisite for production ingest.

The enforcement model follows two access tiers:

1. **Service role / backend workers:** Full read-write access, authenticated via service role key (never exposed to clients). Bypasses RLS entirely — responsibility for correct `tenant_id` filtering rests with the caller.
2. **Anon / client roles:** Denied by default on all V3 tables. V3 is a backend-first system; no direct client DB access is permitted.

RLS policies, when applied to non-service-role paths, enforce `tenant_id`-scoped access at the row level.

---

## 6. Isolation Principles

### Principle 1: `tenant_id` is the primary isolation boundary
Every SELECT, INSERT, UPDATE, and DELETE on a core V3 table must be scoped to a single `tenant_id`. No query may return or modify rows from multiple tenants in a single operation, unless executed by the service role for explicit cross-tenant administrative purposes with documented intent.

### Principle 2: DB enforcement over application enforcement
RLS policies at the Postgres level are the authoritative access boundary. Application-level `WHERE tenant_id = X` filters are a defense-in-depth addition, not a substitute.

### Principle 3: Default deny
All client-facing database roles (anon, authenticated) must have zero access to V3 tables by default. Access is granted explicitly and minimally, only where a legitimate read path from an authenticated user session exists.

### Principle 4: Service role is trusted but not omnipotent
The service role bypasses RLS. This is appropriate for backend workers and RPCs. However, all service-role callers must still carry and pass `tenant_id` explicitly in their logic. A worker that writes to a canonical table without a `tenant_id` argument is a bug, not a feature of the service role.

### Principle 5: Leakage triggers a security incident, not a data bug
If a row belonging to Tenant A becomes visible to Tenant B via any code path, this is treated as a security incident requiring investigation and remediation, not merely a data quality issue.

---

## 7. Tables Requiring RLS

All V3 core tables require RLS enabled and a default-deny policy:

| Table | RLS Required | Access via Service Role | Client Access |
|---|---|---|---|
| `v3_tenants` | Yes | Full | None |
| `v3_sellers` | Yes | Full (scoped by `tenant_id`) | None |
| `v3_stores` | Yes | Full (scoped by `tenant_id`) | None |
| `v3_webhook_events` | Yes | Full (scoped by `tenant_id`) | None |
| `v3_domain_events` | Yes | Full (scoped by `tenant_id`) | None |
| `v3_engine_runs` | Yes | Full (scoped by `tenant_id`) | None |
| `v3_snapshots` | Yes | Full (scoped by `tenant_id`) | None |
| `v3_metrics_daily` | Yes | Full (scoped by `tenant_id`) | None |
| `v3_clinical_signals` | Yes | Full (scoped by `tenant_id`) | None |
| `v3_health_scores` | Yes | Full (scoped by `tenant_id`) | None |

Future tables added to the V3 core are subject to the same default-deny rule from the moment of creation.

---

## 8. Permitted Operations by Role

### 8.1 Service Role (backend workers, RPCs, orchestrators)

- Full read, insert, update, delete on all V3 tables.
- Bypasses RLS at the DB level.
- **Obligations:** All callers must pass `tenant_id` explicitly. No "select all" operations without a `tenant_id` scope. No mixing of tenant data in the same transaction.
- Used by: Clinical Orchestrator, Domain Normalizer, Provider Adapters (ingest only), Reconciliation Workers, Score Aggregator.

### 8.2 Provider Adapters

- Access scope: `v3_webhook_events` only (write-access, insert + idempotent upsert).
- Must resolve `tenant_id` and `store_id` before calling any writer.
- Must not access any other V3 table directly.
- Authentication: service role key, passed server-side only.

### 8.3 Internal Operational Read (dashboards, health check APIs)

- May read from `v3_health_scores`, `v3_clinical_signals`, `v3_stores` for a specific authenticated user session.
- Must be scoped to the tenant associated with the authenticated session.
- Access is mediated by the application layer (Next.js API routes), not by direct client DB access.
- The application must verify `tenant_id` from the session token before constructing any query.

### 8.4 Anonymous / Unauthenticated

- No access. Zero. All V3 tables return empty results or permission errors to the anon role.

---

## 9. Prohibitions

| Prohibited Pattern | Reason |
|---|---|
| Client-side DB access to any V3 table | V3 is a backend system; no Supabase client key may be used directly against V3 tables from the user's browser or mobile |
| Service role key exposed in frontend code | Service role bypasses RLS; exposure creates a full tenant-boundary bypass |
| RPC or function returning rows from multiple tenants in a single call | Violates Principle 1; must be rejected in code review |
| Worker writing to a V3 table without an explicit `tenant_id` argument | Even under service role, this is a logic bug |
| Disabling RLS on a V3 table for "performance" | Performance must be addressed via indexes and query design, not by removing the isolation guarantee |
| Skipping RLS rollout because "it's still dev" | The schema is in production. RLS must be applied before any real tenant data enters V3 tables |

---

## 10. Relationship Between Canonical Identity and Security Enforcement

ADR-0010 defines the canonical identity model. ADR-0012 defines its enforcement.

The relationship is:

- ADR-0010 guarantees that every row **carries** the right identity fields (`tenant_id`, `store_id`, etc.).
- ADR-0012 guarantees that access to rows is **bounded** by those identity fields.

One without the other is incomplete:
- Identity without enforcement: rows are labeled correctly but anyone can read any label.
- Enforcement without identity: the DB gate exists but has nothing to gate on because rows have no reliable identity.

**Both must be in place before any row populated by a real tenant carries clinical significance.**

---

## 11. Consequences

### Positive
- Multi-tenant isolation moves from a convention to a contract enforced at the DB layer.
- Any failure to scope a query by `tenant_id` is caught at the DB boundary, not silently executed.
- Adds a structural defense against bugs, misconfigured workers, and token misuse.
- Enables future compliance posture (data residency, audit rights, privacy obligations).

### Negative
- Requires an additional migration pass after the DDL base is applied (the RLS policies themselves).
- All new tables require RLS configuration at creation time — this adds a step to any future schema work.
- Query plans must be verified to confirm RLS predicates are pushed down efficiently.
- RLS adds tuples cost in query planning; indexes on `tenant_id` (already present) are required to absorb this.

---

## 12. Criteria Before Production Ingest

The following conditions must all be true before any V3 table receives data from a real production tenant:

| # | Criterion | Verified by |
|---|---|---|
| 1 | RLS `ENABLE ROW LEVEL SECURITY` applied to all 10 core V3 tables | Migration + SQL verification query |
| 2 | Default-deny policy in place (anon role returns 0 rows on all V3 tables) | Integration test or manual SQL check |
| 3 | Service role writer contracts verified (callers pass `tenant_id` explicitly) | Code review of each governed writer |
| 4 | No service role key present in any client-side code path | Security review of Next.js client components |
| 5 | Operational read paths verified to scope queries by `tenant_id` from session | API route review |
| 6 | At least one integration test confirming cross-tenant read returns 0 rows | Automated test or documented manual evidence |

Failure to meet any single criterion means V3 is not ready for live tenant data.

---

## Related ADRs

- ADR-0009: V3 Canonical Rebuild Strategy *(prerequisite)*
- ADR-0010: V3 Canonical Identity and Tenancy Model *(enforced by this ADR)*
- ADR-0011: V3 Pipeline Ownership and Writer Governance *(writers governed by this ADR)*
