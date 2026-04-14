"""
Integration tests: rerun flow after human resolution.
  1. rerun blocked when pending clarifications exist
  2. rerun works after all resolved → ok + signals + batch_result
  3. rerun does not duplicate clarifications
  4. rerun does not call action_engine directly
"""
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services import clarification_service as cs
from app.services import job_service as js
from app.run_pipeline import run_pipeline


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch):
    db = tmp_path / "clarifications.db"
    monkeypatch.setattr(cs, "_DB_PATH", db)
    monkeypatch.setattr(js, "_DB_PATH", db)


@pytest.fixture()
def client(isolated_db):
    from app.api.routes.jobs import router as jobs_router
    from app.api.routes.clarifications import router as clarifications_router
    _app = FastAPI()
    _app.include_router(jobs_router)
    _app.include_router(clarifications_router)
    return TestClient(_app)


_MOCK_BLOCKED = {
    "status": "blocked",
    "uncertainties": [
        {"value_a": "prod x", "value_b": "prod y", "similarity": 0.82, "requires_validation": True}
    ],
}

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


def _trigger_blocked_job() -> str:
    """Run pipeline to produce a blocked result and return the job_id."""
    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=_MOCK_BLOCKED):
            result = run_pipeline(**_PIPELINE_KWARGS)
    assert result["status"] == "blocked"
    return result["job_id"]


# ---------------------------------------------------------------------------
# 1. Rerun blocked when pending clarifications exist
# ---------------------------------------------------------------------------

def test_rerun_blocked_when_pending(client):
    job_id = _trigger_blocked_job()
    # clarifications are now pending — rerun must block
    resp = client.post(f"/api/v1/jobs/{job_id}/rerun")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "blocked"
    assert body["reason"] == "pending_clarifications"
    assert body["job_id"] == job_id


# ---------------------------------------------------------------------------
# 2. Rerun works after all resolved → ok + signals + batch_result
# ---------------------------------------------------------------------------

def test_rerun_ok_after_resolution(client):
    job_id = _trigger_blocked_job()

    # Resolve all pending
    for item in cs.get_pending_clarifications():
        cs.resolve_clarification(item["id"], "accepted")

    with patch("app.api.routes.jobs.smartcounter_run_pipeline", return_value=_MOCK_OK):
        with patch("app.api.routes.jobs.orchestrator_run", return_value=_MOCK_ORCH):
            resp = client.post(f"/api/v1/jobs/{job_id}/rerun")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["job_id"] == job_id
    assert "signals" in body
    assert "batch_result" in body
    assert body["batch_result"]["batch_status"] == "success"


# ---------------------------------------------------------------------------
# 3. Rerun does not duplicate clarifications
# ---------------------------------------------------------------------------

def test_rerun_does_not_duplicate_clarifications(client):
    job_id = _trigger_blocked_job()

    # Resolve all
    for item in cs.get_pending_clarifications():
        cs.resolve_clarification(item["id"], "accepted")

    conn = cs._get_connection()
    count_before = conn.execute("SELECT COUNT(*) FROM clarifications").fetchone()[0]
    conn.close()

    with patch("app.api.routes.jobs.smartcounter_run_pipeline", return_value=_MOCK_OK):
        with patch("app.api.routes.jobs.orchestrator_run", return_value=_MOCK_ORCH):
            client.post(f"/api/v1/jobs/{job_id}/rerun")

    conn = cs._get_connection()
    count_after = conn.execute("SELECT COUNT(*) FROM clarifications").fetchone()[0]
    conn.close()

    assert count_after == count_before  # no new clarifications inserted


# ---------------------------------------------------------------------------
# 4. Rerun does not call action_engine directly
# ---------------------------------------------------------------------------

def test_rerun_does_not_call_action_engine(client):
    job_id = _trigger_blocked_job()

    for item in cs.get_pending_clarifications():
        cs.resolve_clarification(item["id"], "accepted")

    with patch("app.api.routes.jobs.smartcounter_run_pipeline", return_value=_MOCK_OK):
        with patch("app.api.routes.jobs.orchestrator_run", return_value=_MOCK_ORCH):
            with patch("app.services.action_engine.from_signals.execute_action_from_signal") as mock_ae:
                resp = client.post(f"/api/v1/jobs/{job_id}/rerun")

    assert resp.status_code == 200
    mock_ae.assert_not_called()


# ---------------------------------------------------------------------------
# Edge: rerun unknown job_id → 404
# ---------------------------------------------------------------------------

def test_rerun_unknown_job_returns_404(client):
    resp = client.post("/api/v1/jobs/nonexistent_job/rerun")
    assert resp.status_code == 404
