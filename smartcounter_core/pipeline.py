"""Main pipeline for smartcounter_core."""
from typing import Any, Dict

from smartcounter_core.ingestion import ingest_excel
from smartcounter_core.normalization import normalize_rows
from smartcounter_core.entity_resolution import resolve_entities
from smartcounter_core.comparison import compare_entities
from smartcounter_core.findings import generate_findings


def run_pipeline(file_a: str, file_b: str) -> Dict[str, Any]:
    rows_a_raw = ingest_excel(file_a)
    rows_b_raw = ingest_excel(file_b)

    rows_a = normalize_rows(rows_a_raw)
    rows_b = normalize_rows(rows_b_raw)

    entities, uncertainties = resolve_entities(rows_a, rows_b)

    if uncertainties:
        return {
            "status": "blocked",
            "uncertainties": [u.to_dict() for u in uncertainties],
        }

    comparisons = compare_entities(entities)
    findings = generate_findings(comparisons)

    return {
        "status": "ok",
        "findings": [f.to_dict() for f in findings],
    }
