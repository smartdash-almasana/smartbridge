# SmartBridge / SmartCounter — AGENTS.md

## Working mode
- Continue from the current repo state.
- Do not redesign the architecture.
- Make minimal, verifiable, merge-ready changes.
- Prefer small diffs over broad refactors.

## Hard constraints
- Do not touch `action_engine` unless explicitly requested.
- Keep existing contracts unless the task explicitly requires a contract change.
- Preserve tenant isolation.
- Avoid side effects unless the task explicitly requires write behavior.
- Do not invent data, recipients, or business facts.
- Follow the pattern: generate → show → confirm → execute.

## Delivery format
Always return:
1. FILES CHANGED
2. DIFF
3. TEST RESULTS
4. NOTES

## Testing
- Run the slice-specific tests first.
- If the change touches shared flow, run:
  - `pytest tests/integration/ -v -x`

## Repo priorities
When working on operational flow, prioritize these services first:
- `app/services/inbox_service.py`
- `app/services/communication_layer.py`
- `app/services/delivery_adapter.py`
- `app/services/notification_orchestrator.py`
- `app/services/audit_trail.py`

## Existing architecture
Core flow:
data → entity → clarification → finding → communication → action draft → confirmation → actions route → action_engine

Operational flow already merged:
findings → human messages → prioritized inbox → notification orchestrator → controlled delivery

## Current known debt
- `app/services/clarification_service.py` still uses `datetime.utcnow()` and emits a deprecation warning on Python 3.14.
- Treat this as non-blocking unless the current task is specifically about time/UTC hardening.

## Coding style
- Backend production style.
- Short helpers are preferred over large monolithic functions.
- Keep behavior deterministic.
- Do not add new infrastructure unless strictly necessary.
- No Celery, Redis, queues, or scheduling unless explicitly requested.

## Recurring policy
- If a task can be solved by reusing an existing service, reuse it.
- If a task requires a new service, keep it narrow and explicit.
- If the same mistake appears twice, update this file so the rule persists.