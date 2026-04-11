# SmartSeller — Technical Documentation

## Purpose

Canonical entry point for SmartSeller technical documentation.

This directory contains both historical V2 material and the current V3 clinical platform documentation.

Current implementation status:

**V3 is the active source of truth.** V2 is legacy/historical reference only.

| Layer | Status |
|---|---|
| V3 canonical pipeline end-to-end | ✅ READY |
| V3 operational orchestrator | ✅ READY |
| V3 heartbeat and stage diagnostics | ✅ READY |
| `GET /api/v3/clinical-status` — 1st read-only surface | ✅ CLOSED |
| `GET /api/v3/run-history` — 2nd read-only surface | ✅ CLOSED |
| `GET /api/v3/store-pulse` — 3rd read-only surface | ✅ CLOSED |
| `/v3/internal/store-pulse` — internal UI | ✅ ACTIVE |
| V3 read model pattern (anti-bug discipline) | ✅ DOCUMENTED |
| V2 | 🔒 Stabilization only — no structural expansion |
| Shopify | ⏸ Out of scope at this V3 stage |

---

## Architecture

- [V3 Pipeline Status](./status/V3_PIPELINE_READY.md)
- [Overview](./architecture/overview.md)
- [Identity Model](./architecture/identity-model.md)
- [Event Pipeline](./architecture/event-pipeline.md)

Defines the core system principles, identity boundaries, and deterministic clinical pipeline:
`webhook_events → domain_events → snapshots → metrics → clinical_signals → health_score`.

Operational source of truth for the current platform state:

- V3 clinical pipeline and operational readiness: [V3 Pipeline Status](./status/V3_PIPELINE_READY.md)
- V3 read model pattern (anti-bug discipline): [V3_READ_MODEL_PATTERN](./architecture/V3_READ_MODEL_PATTERN.md)
- V3 governance and ownership: [ADR-0011](./adr/ADR-0011-v3-pipeline-ownership-and-writer-governance.md)
- V3 identity and tenancy: [ADR-0010](./adr/ADR-0010-v3-canonical-identity-and-tenancy-model.md)
- V3 roadmap progress: [ROADMAP_STATUS_CONTRAST](./roadmap/ROADMAP_STATUS_CONTRAST.md)

---

## Auth

- [OAuth Supabase + Google](./auth/oauth-supabase-google.md)
- [OAuth Mercado Libre](./auth/oauth-mercadolibre.md)
- [Session & Cookies Model](./auth/session-and-cookies.md)
- [Documento OAuth](./Documento%20OAuth.md)

Documents:
- Human session model (Google via Supabase)
- External account linkage (Mercado Libre OAuth)
- Cookie propagation rules
- Installation and token lifecycle
- Session invariants and failure modes

---

## Database

- [DDL Core](./database/ddl-core.md)
- [RLS Policies](./database/rls-policies.md)

Defines:
- Canonical identity model (`tenant_id`, `store_id`, `seller_uuid`)
- Multi-tenant isolation guarantees
- Idempotent ingestion rules
- Reproducible clinical state

---

## Operations

- [Vercel Environment Variables](./operations/vercel-env.md)
- [Runbooks](./operations/runbooks.md)

Operational procedures for:
- OAuth failures
- Session 401 errors
- Token expiration
- Webhook failures
- Clinical drift detection

---

## Product

- [Dashboard Clinical UX](./product/dashboard-clinical-ux.md)

Defines the clinical dashboard information hierarchy:

1. State  
2. Alerts  
3. Operational Context  
4. Configuration  

Includes wizard activation rules and UX invariants.

---

## ADR

- [ADR-0003 — Session Model](./adr/ADR-0003-session-model.md)

Architectural Decision Records define irreversible or high-impact structural decisions affecting:

- Identity model
- OAuth boundaries
- RLS guarantees
- Clinical scoring rules
- Token persistence model

---

## Global Invariants

- SmartSeller is a **clinical multi-tenant system**, not a vanity analytics dashboard.
- The dashboard never consumes raw `webhook_events`.
- Every clinical state must be reconstructible from persisted history.
- Identity separation between internal (`store_id`) and external (`external_account_id`) is mandatory.
- Scores must be deterministic for a given time window and rule version.
- V3 is the forward canonical base; V2 is not the future platform foundation.
- Shopify is not part of the active V3 delivery scope at this stage.

---

## Maintenance Rules

Whenever architecture changes:

- Update `architecture/`
- Update `auth/`
- Update `database/`
- Update `operations/`
- Update `product/`
- Create or update an ADR when required

Documentation drift is considered a structural defect.
