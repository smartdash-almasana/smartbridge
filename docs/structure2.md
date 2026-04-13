1. Structure
Root (relevant): app/, tests/, data/, scripts/, docs/, requirements.txt, signals_engine.py.
App entrypoints: app/main.py, app/run_pipeline.py, scripts/reconcile_smoke.py.
API layer: app/api/routes/landing.py, app/api/routes/saas.py, app/api/routes/telegram.py, app/api/routes/entity.py, app/api/routes/reconcile.py.
Domain/services core: app/services/reconciliation, app/services/normalized_signals, app/services/signals, app/services/action_engine, app/services/digest, plus findings_engine, ingestion_loader, ingestion_persistence, ingestion/service.
Config/core: app/core/time_provider.py, app/core/config.py (empty).
Domain package: app/domain/order exists, files are empty.
Tests: pytest suite under tests/ and tests/services/* (16 .py test files).
2. Architecture
Style: mixed modular monolith.
HTTP/API shell: FastAPI app in app/main.py.
Service modules: reconciliation pipeline, normalization, lifecycle, digest, action dispatch.
Persistence: filesystem JSON/CSV artifacts and SQLite lifecycle/pending-action tables.
Data flow variants:
SaaS flow is route-heavy (/saas/upload) with orchestration and business logic inside route file.
Reconciliation flow is service-layered (normalize -> match -> diff -> signals -> findings -> normalized_signals -> lifecycle -> action_engine) and is exercised in tests.
Event/webhook flow: Telegram webhook processes command-like responses and updates SQLite state.
3. Modules
entity_resolution: exists at app/services/entity_resolution_service.py, route at app/api/routes/entity.py.
findings_engine: exists at app/services/findings_engine.py.
Signals-like logic: exists in multiple places:
app/services/reconciliation/signals.py (reconciliation signal generation).
app/services/normalized_signals/service.py (findings -> normalized signals).
app/services/signals/global_signals.py (global ID + lifecycle).
signals_engine.py (top-level findings->signals mapper).
Ingestion pipeline: app/services/ingestion_loader.py (run_ingestion_pipeline), app/services/ingestion_persistence.py, app/services/ingestion/service.py.
Webhook handlers: app/api/routes/telegram.py -> app/services/telegram/loop.py.
External integrations:
Telegram HTTP API in app/services/telegram/loop.py (send_telegram_message).
Optional OpenAI call in app/services/entity_resolution_service.py (resolve_with_llm).
4. Contracts
API request contract (/reconcile): {"events": list[dict], "documents": list[dict]} in app/api/routes/reconcile.py.
Findings structure A (app/services/findings_engine.py):
{"type":"amount_mismatch","severity":"high","description":"...","entity_id":"E1","metadata":{...}}
Findings structure B (app/services/reconciliation/module_adapter.py):
{"finding_id":"fnd_order_mismatch_order_101","type":"order_mismatch","severity":"high","message":"...","entity_ref":"order_101","context":["..."]}
Normalized signals input (from tests tests/services/normalized_signals/test_normalized_signals.py):
{"module":"order_reconciliation","generated_at":"2026-04-10T15:00:00+00:00","findings":[{"type":"order_mismatch","severity":"medium","entity_ref":"order_123","context":["amount mismatch"]}]}
Normalized signals output keys (app/services/normalized_signals/service.py): signals[] with signal_id, signal_code, severity, priority_score, entity_ref, source_module, ingestion_id, created_at, context; summary with total_signals, high_priority, medium_priority, low_priority.
Lifecycle output (app/services/signals/global_signals.py): {"current":[...], "lifecycle":{"open":[...], "persisting":[...], "resolved":[...]}}.
Action job output (app/services/action_engine/from_signals.py): action_id, tenant_id, global_signal_id, signal_code, entity_ref, action_type, priority_score, status, created_at, context.
Storage artifacts:
data/ingestions/<ingestion_id>/{ventas|facturas}/{input.csv,normalized.json,metadata.json} (app/services/ingestion_persistence.py).
data/<tenant_id>/<module>/<ingestion_id>/{input.json,canonical_rows.json,findings.json,summary.json,suggested_actions.json} (app/services/ingestion/service.py).
SQLite tables: signals_current, signals_history, pending_actions, processed_messages (app/services/signals/lifecycle_persistence.py, app/services/telegram/loop.py).
5. Flow
Flow A (mounted): POST /saas/upload -> run_ingestion_pipeline -> persist_ingestion -> _build_signals -> database.upsert_signal (SQLite in-memory) -> build_digest -> build_action_output -> HTML/JSON response.
Flow B (mounted): POST /telegram/webhook -> handle_telegram_update -> dispatch_actions + logs.write (via injected MCP executor) -> SQLite pending/actions state update -> Telegram confirmation message.
Flow C (service pipeline used in tests): build_reconciliation_module_payload -> build_normalized_signals -> compute_signal_lifecycle -> build_action_jobs_from_signals.
Flow D (mounted): POST /entity/resolve -> resolve_entity -> deterministic match (email/alias) -> optional LLM fallback -> response.
Note: /reconcile route exists but is not included in app/main.py.
6. State
Filesystem state: persistent under data/ingestions and data/<tenant>/<module>.
SQLite state:
In-memory SQLite in SaaS upload path (sqlite3.connect(":memory:")).
File-backed SQLite for Telegram loop (TELEGRAM_LOOP_DB_PATH or telegram_loop.sqlite3).
In-process globals: injected callables in telegram loop (_mcp_execute, _send_impl) and in signal batch processor (mcp_execute, dispatch).
No async workers/queues observed; synchronous request-time execution.
7. Testing
pytest present (imports in tests; .pytest_cache exists).
Test files: 16 Python test files under tests/ and tests/services/*.
Coverage rough:
Strongest: normalized_signals, signals lifecycle persistence, digest builders, telegram loop robustness, pipeline integration.
Limited: API router breadth, entity resolution route behavior depth, reconciliation route mounting, ingestion_loader internals.
8. Stack
Framework: FastAPI.
Core libs from requirements.txt: fastapi, uvicorn, pydantic, python-dotenv, pandas, python-multipart, jinja2, openpyxl.
Data/persistence: JSON/CSV filesystem, SQLite (sqlite3).
Template/UI server-side: Jinja2 templates in app/api/templates.
Patterns observed: function-first service modules, Pydantic request/response models in some routes, deterministic ID/hash strategies in signal/action modules.
9. Risks
Multiple signal layers and mappings coexist: app/services/reconciliation/signals.py, app/services/normalized_signals/service.py, signals_engine.py, app/services/digest/grouping.py, app/services/action_engine/from_signals.py.
Route/business coupling: substantial business logic in app/api/routes/saas.py (ingestion, signal generation, lifecycle persistence, digest/action composition).
Unmounted route risk: app/api/routes/reconcile.py not registered in app/main.py.
Hidden failure risk: broad exception swallowing in app/services/ingestion_persistence.py and app/services/ingestion_loader.py.
Contract drift risk: app/services/digest/render_digest.py expects different digest shape (summary.total/high/..., focus, top_signals) than app/services/digest/build_digest.py output.
Non-deterministic timestamps/IDs in runtime paths (datetime.utcnow, uuid4) unless env overrides are set.
Placeholder/empty modules exist (app/core/config.py, app/domain/order/*, app/adapters/*), indicating incomplete layering boundaries.

