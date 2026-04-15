# STRUCTURE

Last audited: 2026-04-15

## Active runtime map
- `app/main.py` - FastAPI app bootstrap, startup wiring for signal DB tools, and router mounting.
- `app/run_pipeline.py` - SmartCounter bridge entrypoint that blocks on pending clarifications and delegates to orchestrator.
- `app/api/server.py` - `POST /api/v1/process` endpoint (tenant data -> findings -> orchestrator pipeline).

## Mounted routes
- `POST /api/v1/process`
- `GET /inbox?tenant_id=...`
- `GET /api/v1/clarifications`
- `POST /api/v1/clarifications/{clarification_id}/resolve`
- `POST /api/v1/jobs/{job_id}/rerun`

## Core runtime services
- `app/services/orchestrator/run_pipeline.py` - canonical runtime coordinator: signals mapping, lifecycle classification, and batch processing.
- `signals_engine.py` - findings-to-signal adapter still called by orchestrator runtime.
- `app/services/inbox_service.py` - builds tenant-scoped operational inbox, pending actions, and priority items.
- `app/services/notification_policy.py` - applies notification eligibility, deduplication, and per-channel caps.
- `app/services/notification_orchestrator.py` - reads inbox priorities, applies policy, groups by channel, and triggers delivery.
- `app/services/delivery_adapter.py` - executes or previews outbound telegram/email deliveries with auditing.
- `app/services/notification_history.py` - returns tenant-scoped notification history from audit events.
- `app/services/clarification_service.py` - persists uncertainties and manages clarification resolution state.
- `app/services/job_service.py` - stores blocked jobs and supports explicit rerun lifecycle.

## Runtime chains
1. API pipeline: `POST /api/v1/process` -> `build_findings` -> `orchestrator.run_pipeline` -> lifecycle + batch result.
2. Inbox and notifications: `GET /inbox` -> `inbox_service` priority items -> `notification_policy` -> `notification_orchestrator` -> `delivery_adapter`.
3. Clarification / rerun flow: SmartCounter blocked result -> `clarification_service.save_clarifications` + `job_service.save_job` -> resolve via clarifications endpoint -> rerun via jobs endpoint.

## Important notes
- `signals_engine.py` is still active in current runtime.
- consolidation is still pending.
- `app/api/routes/reconcile.py` exists but is not mounted in `app/main.py`.
- placeholder modules still exist under:
  - `app/core/config.py`
  - `app/domain/order/`
  - `app/adapters/`

## Test areas currently exercised
- API/integration paths: process pipeline, inbox route, clarifications, rerun flow, notifications, audit trail.
- Service paths: orchestrator/lifecycle, normalized signals, delivery adapter, digest builders, Telegram loop robustness.
- Unit coverage includes `signals_engine` and action/communication layers.
