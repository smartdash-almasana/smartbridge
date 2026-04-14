"""
Smoke test: three end-to-end flows.
  1. Normal flow  → ok + signals + batch_result
  2. Uncertain    → blocked + clarifications saved
  3. Resolve + rerun → ok + signals + batch_result
"""
import shutil
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import clarification_service as cs
from app.run_pipeline import run_pipeline


@pytest.fixture(autouse=True)
def isolated_db(monkeypatch):
    base = Path(".tmp_integration")
    base.mkdir(parents=True, exist_ok=True)
    case_dir = base / f"smoke_final_{uuid.uuid4().hex}"
    case_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cs, "_DB_PATH", case_dir / "clarifications.db")
    yield
    shutil.rmtree(case_dir, ignore_errors=True)


_MOCK_OK = {
    "status": "ok",
    "findings": [
        {
            "entity_name": "producto_A",
            "difference": 3,
            "source_a": {"product_name": "producto A", "quantity": 8},
            "source_b": {"product_name": "producto A", "quantity": 5},
        }
    ],
}

_MOCK_BLOCKED = {
    "status": "blocked",
    "uncertainties": [
        {"value_a": "prod x", "value_b": "prod y", "similarity": 0.82, "requires_validation": True}
    ],
}

_MOCK_ORCH = {
    "signals": [{"signal_code": "stock_mismatch_detected", "entity_ref": "producto_A"}],
    "lifecycle": {"open": [], "persisting": [], "resolved": []},
    "batch_result": {"batch_status": "success", "processed": 1, "failed": 0},
}

_PIPELINE_KWARGS = dict(
    tenant_id="t1",
    file_a="a.xlsx",
    file_b="b.xlsx",
    ingestion_id="ing_1",
    correlation_id="corr_1",
    timestamp="2026-01-01T00:00:00Z",
)


def test_smoke_normal_flow():
    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=_MOCK_OK):
            with patch("app.run_pipeline.orchestrator_run", return_value=_MOCK_ORCH):
                result = run_pipeline(**_PIPELINE_KWARGS)

    assert result["status"] == "ok"
    assert "signals" in result and len(result["signals"]) > 0
    assert "batch_result" in result and result["batch_result"] is not None


def test_smoke_uncertain_flow():
    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=_MOCK_BLOCKED):
            result = run_pipeline(**_PIPELINE_KWARGS)

    assert result["status"] == "blocked"
    pending = cs.get_pending_clarifications()
    assert len(pending) == 1
    assert pending[0]["value_a"] == "prod x"


def test_smoke_resolve_then_rerun():
    # Step 1: trigger blocked → save clarification
    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=_MOCK_BLOCKED):
            blocked = run_pipeline(**_PIPELINE_KWARGS)

    assert blocked["status"] == "blocked"
    pending = cs.get_pending_clarifications()
    assert len(pending) == 1

    # Step 2: resolve
    cs.resolve_clarification(pending[0]["id"], "accepted")
    assert cs.has_pending_clarifications() is False

    # Step 3: rerun → ok
    with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=_MOCK_OK):
        with patch("app.run_pipeline.orchestrator_run", return_value=_MOCK_ORCH):
            result = run_pipeline(**_PIPELINE_KWARGS)

    assert result["status"] == "ok"
    assert "signals" in result and len(result["signals"]) > 0
    assert "batch_result" in result and result["batch_result"] is not None
