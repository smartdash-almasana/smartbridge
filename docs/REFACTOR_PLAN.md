# REFACTOR PLAN

## Current pain points
- SmartCounter bridge flow logic is duplicated across `app/run_pipeline.py` and `app/api/routes/jobs.py`.
- Entry points directly depend on multiple low-level bridge concerns (core execution, uncertainty persistence, findings-to-signals mapping, orchestrator call), increasing coupling.
- Reuse boundaries are unclear for future SmartCounter growth (new execution modes, additional bridge adapters, alternate orchestration strategies).

## Proposed module structure
- `app/services/smartcounter_bridge/execution.py`
  - `run_core_pipeline(file_a, file_b)`
  - `persist_uncertainties_if_blocked(result)`
  - `run_orchestrator_from_findings(...)`
- `app/services/smartcounter_bridge/__init__.py`
  - Internal package marker for SmartCounter bridge internals.
- Keep existing public entry points unchanged:
  - `app/run_pipeline.py` (public function `run_pipeline` unchanged)
  - `app/api/routes/jobs.py` (public route path and payload unchanged)

## Safe refactor sequence
1. Extract shared SmartCounter bridge execution helpers into an internal module (`smartcounter_bridge/execution.py`) without changing any payload contract.
2. Rewire `app/api/routes/jobs.py` to use internal bridge helpers while preserving route path, response payload shape, and action_engine boundaries.
3. Keep `app/run_pipeline.py` public behavior and compatibility patch points unchanged (same externally patched symbols and response structure).
4. Verify bridge-level tests and route-level behavior are unchanged.

## Risks to avoid
- Do not move or rename public route handlers or route paths.
- Do not alter response keys (`status`, `signals`, `lifecycle`, `batch_result`, `job_id`, `reason`, `message`, `uncertainties`).
- Do not modify SmartCounter clarification/job persistence schema or DB paths.
- Do not introduce action_engine calls in bridge or rerun flows.
- Do not break existing test patch points in `app.run_pipeline` by removing module-level symbols expected by tests.
