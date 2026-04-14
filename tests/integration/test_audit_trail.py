import shutil
import time
from pathlib import Path
from unittest.mock import patch
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.run_pipeline import run_pipeline
from app.services import clarification_service as cs
from app.services import job_service as js
from app.services import audit_trail as at


@pytest.fixture()
def isolated_audit_db(monkeypatch):
    base_dir = Path(".tmp_audit_tests")
    base_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = base_dir / f"audit_trail_test_{uuid.uuid4().hex}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    audit_db = tmp_dir / "audit_trail.db"
    monkeypatch.setattr(at, "_DB_PATH", audit_db)
    yield audit_db
    shutil.rmtree(tmp_dir, ignore_errors=True)


def test_event_logged(isolated_audit_db) -> None:
    event_id = at.log_job_event("job_1", "rerun_requested", {"source": "test"})
    assert event_id > 0

    events = at.get_job_events("job_1")
    assert len(events) == 1
    assert events[0]["event_type"] == "rerun_requested"
    assert events[0]["payload"]["source"] == "test"


def test_events_returned_by_job_id(isolated_audit_db) -> None:
    at.log_job_event("job_1", "rerun_requested", {"step": 1})
    at.log_job_event("job_2", "rerun_requested", {"step": 1})
    at.log_job_event("job_1", "findings_generated", {"step": 2})

    job_1_events = at.get_job_events("job_1")
    job_2_events = at.get_job_events("job_2")

    assert len(job_1_events) == 2
    assert len(job_2_events) == 1
    assert all(evt["job_id"] == "job_1" for evt in job_1_events)
    assert job_2_events[0]["job_id"] == "job_2"


def test_events_ordered_by_created_at(isolated_audit_db) -> None:
    at.log_job_event("job_1", "rerun_requested", {"idx": 1})
    time.sleep(0.002)
    at.log_job_event("job_1", "findings_generated", {"idx": 2})
    time.sleep(0.002)
    at.log_job_event("job_1", "action_executed", {"idx": 3})

    events = at.get_job_events("job_1")
    assert [e["event_type"] for e in events] == [
        "rerun_requested",
        "findings_generated",
        "action_executed",
    ]


def test_no_behavior_change_in_existing_flow(monkeypatch, isolated_audit_db) -> None:
    base_dir = Path(".tmp_audit_tests")
    base_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = base_dir / f"audit_flow_test_{uuid.uuid4().hex}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        clar_db = tmp_dir / "clarifications.db"
        monkeypatch.setattr(cs, "_DB_PATH", clar_db)
        monkeypatch.setattr(js, "_DB_PATH", clar_db)

        blocked_result = {
            "status": "blocked",
            "uncertainties": [
                {"value_a": "prod x", "value_b": "prod y", "similarity": 0.82, "requires_validation": True}
            ],
        }
        ok_result = {
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
        orch_result = {
            "signals": [{"signal_code": "stock_mismatch_detected", "entity_ref": "producto_A"}],
            "lifecycle": {"open": [], "persisting": [], "resolved": []},
            "batch_result": {"batch_status": "success", "processed": 1, "failed": 0},
        }

        with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
            with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=blocked_result):
                blocked = run_pipeline(
                    tenant_id="t1",
                    file_a="a.xlsx",
                    file_b="b.xlsx",
                    ingestion_id="ing_1",
                    correlation_id="corr_1",
                    timestamp="2026-01-01T00:00:00Z",
                )
        assert blocked["status"] == "blocked"
        job_id = blocked["job_id"]

        for item in cs.get_pending_clarifications():
            cs.resolve_clarification(item["id"], "accepted")

        from app.api.routes.jobs import router as jobs_router
        app = FastAPI()
        app.include_router(jobs_router)
        client = TestClient(app)

        with patch("app.api.routes.jobs.log_job_event", side_effect=Exception("audit down")):
            with patch("app.api.routes.jobs.smartcounter_run_pipeline", return_value=ok_result):
                with patch("app.api.routes.jobs.orchestrator_run", return_value=orch_result):
                    resp = client.post(f"/api/v1/jobs/{job_id}/rerun")

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert "signals" in body
        assert "batch_result" in body
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
