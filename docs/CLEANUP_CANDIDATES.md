# CLEANUP CANDIDATES

## Files safe to clean later
- app/api/routes/saas.py (debug `print(...)` statements present; replace with structured logging in a separate behavior-reviewed change)
- app/services/findings_engine.py (stdout `print(...)` in processing flow; migrate to logger with explicit log levels)
- smartcounter_core/ingestion.py (marked as stub implementation; replace with real ingestion logic in a functional change)
- smartcounter_core/normalization.py (minimal pass-through normalization stub; expand in functional change)

## Duplicate docs detected
- docs/architecture.md, docs/contracts.md, docs/reconciliation_spec_v1.md (all empty files with identical content)
- docs/structure.md and docs/structure2.md (name-level overlap; review for consolidation, not auto-deleted)

## Temporary files/stubs detected
- data/tmp/ (temporary ingestion artifacts)
- tests/test_debug.py (debug-oriented test artifact)
- app/run_pipeline.py (explicit stub return path when `file_a`/`file_b` are missing)
- smartcounter_core/ingestion.py (stub comment + placeholder return)
