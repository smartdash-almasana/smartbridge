import json
import shutil
import sqlite3
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.inbox import router as inbox_router
from app.services import audit_trail as at


@pytest.fixture(autouse=True)
def isolated_audit_db(monkeypatch):
    base = Path(".tmp_inbox_tests")
    base.mkdir(parents=True, exist_ok=True)
    case_dir = base / f"case_{uuid.uuid4().hex}"
    case_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(at, "_DB_PATH", case_dir / "audit_trail.db")

    yield case_dir
    shutil.rmtree(case_dir, ignore_errors=True)


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()
    app.include_router(inbox_router)
    return TestClient(app)


def _create_audit_schema(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE job_audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def _insert_event(
    db_path: Path,
    *,
    job_id: str,
    event_type: str,
    payload: dict,
    created_at: str,
) -> int:
    conn = sqlite3.connect(str(db_path))
    cursor = conn.execute(
        """
        INSERT INTO job_audit_events (job_id, event_type, payload, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (job_id, event_type, json.dumps(payload, sort_keys=True), created_at),
    )
    event_id = int(cursor.lastrowid)
    conn.commit()
    conn.close()
    return event_id


def test_route_responds_200(client: TestClient) -> None:
    resp = client.get("/inbox", params={"tenant_id": "tenant_1"})
    assert resp.status_code == 200


def test_empty_inbox_returns_zero_counts_and_empty_arrays(client: TestClient) -> None:
    resp = client.get("/inbox", params={"tenant_id": "tenant_1"})
    assert resp.status_code == 200
    body = resp.json()

    assert body["tenant_id"] == "tenant_1"
    assert body["counts"] == {
        "pending_clarifications": 0,
        "pending_actions": 0,
        "pending_confirmation": 0,
        "recent_findings": 0,
        "recent_messages": 0,
    }
    assert body["pending_clarifications"] == []
    assert body["pending_actions"] == []
    assert body["recent_findings"] == []
    assert body["recent_messages"] == []


def test_pending_clarifications_is_safe_empty_without_tenant_scope(
    isolated_audit_db, client: TestClient
) -> None:
    # Even with audit data, clarifications remain excluded by safe policy.
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_1",
        event_type="clarification_created",
        payload={"tenant_id": "tenant_1", "clarification_id": 10},
        created_at="2026-04-14T10:00:00Z",
    )

    resp = client.get("/inbox", params={"tenant_id": "tenant_1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["pending_clarifications"] == []
    assert body["counts"]["pending_clarifications"] == 0


def test_inbox_returns_pending_actions(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_1",
        event_type="draft_created",
        payload={
            "tenant_id": "tenant_1",
            "source_finding_id": "fnd_1",
            "draft_type": "review_discrepancy",
            "entity_ref": "order_101",
        },
        created_at="2026-04-14T11:00:00Z",
    )

    resp = client.get("/inbox", params={"tenant_id": "tenant_1"})
    assert resp.status_code == 200
    body = resp.json()

    assert len(body["pending_actions"]) == 1
    assert body["pending_actions"][0]["state"] == "pending_confirmation"
    assert body["counts"]["pending_actions"] == 1
    assert body["counts"]["pending_confirmation"] == 1


def test_pending_actions_tenant_isolation_excludes_unknown_scope(
    client: TestClient, isolated_audit_db
) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    # Missing tenant_id in payload => excluded
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_unsafe",
        event_type="draft_created",
        payload={"source_finding_id": "unsafe"},
        created_at="2026-04-14T12:00:00Z",
    )

    resp = client.get("/inbox", params={"tenant_id": "tenant_1"})
    assert resp.status_code == 200
    assert resp.json()["pending_actions"] == []


def test_order_is_deterministic_with_tie_breaks(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    # Same created_at => tie-break by event id desc.
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_1",
        event_type="rerun_requested",
        payload={"tenant_id": "tenant_1"},
        created_at="2026-04-14T13:00:00Z",
    )
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_1",
        event_type="draft_created",
        payload={"tenant_id": "tenant_1", "source_finding_id": "fnd_a"},
        created_at="2026-04-14T13:00:00Z",
    )

    resp1 = client.get("/inbox", params={"tenant_id": "tenant_1"})
    resp2 = client.get("/inbox", params={"tenant_id": "tenant_1"})
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    body1 = resp1.json()
    body2 = resp2.json()
    assert body1 == body2
    assert body1["recent_messages"][0]["event_type"] == "draft_created"
    assert body1["recent_messages"][1]["event_type"] == "rerun_requested"


def test_invalid_tenant_returns_400(client: TestClient) -> None:
    resp = client.get("/inbox", params={"tenant_id": "   "})
    assert resp.status_code == 400

