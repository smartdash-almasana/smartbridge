"""
Integration tests: human resolution flow.
  - pending clarifications listed
  - resolve updates DB
  - rerun continues after resolution
  - resolved clarification not duplicated
"""
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.services import clarification_service as cs
from app.run_pipeline import run_pipeline


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cs, "_DB_PATH", tmp_path / "clarifications.db")


@pytest.fixture()
def client(isolated_db):
    from fastapi import FastAPI
    from app.api.routes.clarifications import router as clarifications_router
    _app = FastAPI()
    _app.include_router(clarifications_router)
    return TestClient(_app)


_MOCK_BLOCKED = {
    "status": "blocked",
    "uncertainties": [
        {"value_a": "prod x", "value_b": "prod y", "similarity": 0.82, "requires_validation": True},
        {"value_a": "item a", "value_b": "item b", "similarity": 0.79, "requires_validation": True},
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


# ---------------------------------------------------------------------------
# 1. Pending clarifications listed
# ---------------------------------------------------------------------------

def test_pending_clarifications_listed(client):
    cs.save_clarifications(_MOCK_BLOCKED["uncertainties"])

    resp = client.get("/api/v1/clarifications")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["value_a"] == "prod x"
    assert data[1]["value_a"] == "item a"
    assert all(not item["resolved"] for item in data)


def test_pending_list_empty_when_none(client):
    resp = client.get("/api/v1/clarifications")
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# 2. Resolve updates DB
# ---------------------------------------------------------------------------

def test_resolve_updates_db(client):
    ids = cs.save_clarifications([{"value_a": "x", "value_b": "y", "similarity": 0.85}])

    resp = client.post(
        f"/api/v1/clarifications/{ids[0]}/resolve",
        json={"resolution": "accepted"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "resolved"
    assert body["id"] == ids[0]
    assert body["resolution"] == "accepted"

    assert cs.has_pending_clarifications() is False


def test_resolve_unknown_id_returns_404(client):
    resp = client.post("/api/v1/clarifications/9999/resolve", json={"resolution": "accepted"})
    assert resp.status_code == 404


def test_resolve_already_resolved_returns_404(client):
    ids = cs.save_clarifications([{"value_a": "x", "value_b": "y", "similarity": 0.85}])
    cs.resolve_clarification(ids[0], "accepted")

    resp = client.post(
        f"/api/v1/clarifications/{ids[0]}/resolve",
        json={"resolution": "accepted"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 3. Rerun continues after all resolved
# ---------------------------------------------------------------------------

def test_rerun_continues_after_resolution():
    # Trigger blocked → save clarifications
    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=_MOCK_BLOCKED):
            blocked = run_pipeline(**_PIPELINE_KWARGS)

    assert blocked["status"] == "blocked"
    pending = cs.get_pending_clarifications()
    assert len(pending) == 2

    # Resolve all
    for item in pending:
        cs.resolve_clarification(item["id"], "accepted")

    assert cs.has_pending_clarifications() is False

    # Rerun → ok
    with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=_MOCK_OK):
        with patch("app.run_pipeline.orchestrator_run", return_value=_MOCK_ORCH):
            result = run_pipeline(**_PIPELINE_KWARGS)

    assert result["status"] == "ok"
    assert "signals" in result
    assert "batch_result" in result


# ---------------------------------------------------------------------------
# 4. Resolved clarification not duplicated on rerun
# ---------------------------------------------------------------------------

def test_resolved_clarification_not_duplicated():
    # First blocked run → 1 clarification saved
    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.smartcounter_run_pipeline", return_value={
            "status": "blocked",
            "uncertainties": [
                {"value_a": "prod x", "value_b": "prod y", "similarity": 0.82, "requires_validation": True}
            ],
        }):
            run_pipeline(**_PIPELINE_KWARGS)

    pending = cs.get_pending_clarifications()
    assert len(pending) == 1
    cs.resolve_clarification(pending[0]["id"], "accepted")

    # Second run returns ok — no new clarifications inserted
    with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=_MOCK_OK):
        with patch("app.run_pipeline.orchestrator_run", return_value=_MOCK_ORCH):
            run_pipeline(**_PIPELINE_KWARGS)

    # Only the original resolved record exists — no duplicates
    conn = cs._get_connection()
    total = conn.execute("SELECT COUNT(*) FROM clarifications").fetchone()[0]
    conn.close()
    assert total == 1
