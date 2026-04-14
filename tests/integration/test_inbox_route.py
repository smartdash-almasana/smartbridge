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
        "priority_items": 0,
    }
    assert body["pending_clarifications"] == []
    assert body["pending_actions"] == []
    assert body["recent_findings"] == []
    assert body["recent_messages"] == []
    assert body["priority_items"] == []


def test_pending_clarifications_is_safe_empty_without_tenant_scope(
    isolated_audit_db, client: TestClient
) -> None:
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


def test_priority_items_present_and_limited_to_five(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    for idx in range(7):
        _insert_event(
            isolated_audit_db / "audit_trail.db",
            job_id=f"job_{idx}",
            event_type="rerun_requested",
            payload={"tenant_id": "tenant_1", "message": f"Evento {idx}"},
            created_at=f"2026-04-14T14:00:0{idx}Z",
        )

    resp = client.get("/inbox", params={"tenant_id": "tenant_1"})
    assert resp.status_code == 200
    body = resp.json()
    assert "priority_items" in body
    assert len(body["priority_items"]) == 5
    assert body["counts"]["priority_items"] == 5


def test_pending_actions_rank_above_findings_and_messages(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_msg",
        event_type="rerun_requested",
        payload={"tenant_id": "tenant_1", "message": "Pedido de rerun"},
        created_at="2026-04-14T15:00:00Z",
    )
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_find",
        event_type="findings_generated",
        payload={
            "tenant_id": "tenant_1",
            "findings": [
                {
                    "finding_id": "f_high",
                    "entity_ref": "sku_1",
                    "difference": 15,
                    "source_a_value": 20,
                    "source_b_value": 5,
                }
            ],
        },
        created_at="2026-04-14T15:00:01Z",
    )
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_act",
        event_type="draft_created",
        payload={
            "tenant_id": "tenant_1",
            "source_finding_id": "f_action",
            "entity_ref": "order_1",
            "draft_type": "review_discrepancy",
        },
        created_at="2026-04-14T15:00:02Z",
    )

    body = client.get("/inbox", params={"tenant_id": "tenant_1"}).json()
    assert body["priority_items"][0]["kind"] == "pending_action"
    assert body["priority_items"][1]["kind"] == "finding"
    assert body["priority_items"][2]["kind"] == "message"


def test_findings_priority_alta_media_baja(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_urg",
        event_type="findings_generated",
        payload={
            "tenant_id": "tenant_1",
            "findings": [
                {"finding_id": "f_a", "difference": 12, "entity_ref": "e1"},
                {"finding_id": "f_m", "difference": 6, "entity_ref": "e2"},
                {"finding_id": "f_b", "difference": 1, "entity_ref": "e3"},
            ],
        },
        created_at="2026-04-14T16:00:00Z",
    )

    body = client.get("/inbox", params={"tenant_id": "tenant_1"}).json()
    finding_items = [item for item in body["priority_items"] if item["kind"] == "finding"]
    assert [item["urgency"] for item in finding_items[:3]] == ["alta", "media", "baja"]


def test_priority_tiebreak_is_deterministic(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_1",
        event_type="rerun_requested",
        payload={"tenant_id": "tenant_1", "message": "m1"},
        created_at="2026-04-14T17:00:00Z",
    )
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_2",
        event_type="rerun_requested",
        payload={"tenant_id": "tenant_1", "message": "m2"},
        created_at="2026-04-14T17:00:00Z",
    )

    body1 = client.get("/inbox", params={"tenant_id": "tenant_1"}).json()
    body2 = client.get("/inbox", params={"tenant_id": "tenant_1"}).json()
    assert body1["priority_items"] == body2["priority_items"]


def test_finding_priority_uses_humanized_summary(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_human",
        event_type="findings_generated",
        payload={
            "tenant_id": "tenant_1",
            "findings": [
                {
                    "finding_id": "f_human",
                    "entity_ref": "sku_h",
                    "difference": 4,
                    "source_a_value": 9,
                    "source_b_value": 5,
                }
            ],
        },
        created_at="2026-04-14T18:00:00Z",
    )

    body = client.get("/inbox", params={"tenant_id": "tenant_1"}).json()
    finding_item = next(item for item in body["priority_items"] if item["kind"] == "finding")
    assert "Comparacion" in finding_item["summary"]
    assert "sku_h" in finding_item["summary"]


def test_priority_items_respect_tenant_isolation(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_other_tenant",
        event_type="draft_created",
        payload={"tenant_id": "tenant_2", "entity_ref": "order_x"},
        created_at="2026-04-14T19:00:00Z",
    )

    body = client.get("/inbox", params={"tenant_id": "tenant_1"}).json()
    assert body["priority_items"] == []
    assert body["counts"]["priority_items"] == 0


def test_priority_items_do_not_duplicate_pending_action_finding(client: TestClient, isolated_audit_db) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_dup",
        event_type="draft_created",
        payload={
            "tenant_id": "tenant_1",
            "source_finding_id": "f_dup",
            "entity_ref": "order_dup",
            "draft_type": "review_discrepancy",
        },
        created_at="2026-04-14T20:00:00Z",
    )
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_dup",
        event_type="findings_generated",
        payload={
            "tenant_id": "tenant_1",
            "findings": [{"finding_id": "f_dup", "entity_ref": "order_dup", "difference": 12}],
        },
        created_at="2026-04-14T20:00:01Z",
    )

    body = client.get("/inbox", params={"tenant_id": "tenant_1"}).json()
    kinds = [item["kind"] for item in body["priority_items"]]
    assert kinds.count("pending_action") == 1
    assert not any(
        item["kind"] == "finding" and str(item.get("entity_ref")) == "order_dup"
        for item in body["priority_items"]
    )


def test_priority_items_do_not_duplicate_pending_action_as_message(
    client: TestClient, isolated_audit_db
) -> None:
    _create_audit_schema(isolated_audit_db / "audit_trail.db")
    _insert_event(
        isolated_audit_db / "audit_trail.db",
        job_id="job_msg_dup",
        event_type="draft_created",
        payload={
            "tenant_id": "tenant_1",
            "source_finding_id": "f_msg_dup",
            "entity_ref": "order_msg_dup",
            "draft_type": "review_discrepancy",
        },
        created_at="2026-04-14T20:30:00Z",
    )

    body = client.get("/inbox", params={"tenant_id": "tenant_1"}).json()
    pending_action_items = [item for item in body["priority_items"] if item["kind"] == "pending_action"]
    message_items = [item for item in body["priority_items"] if item["kind"] == "message"]

    assert len(pending_action_items) == 1
    assert pending_action_items[0]["job_id"] == "job_msg_dup"
    assert not any(item.get("job_id") == "job_msg_dup" for item in message_items)


def test_invalid_tenant_returns_400(client: TestClient) -> None:
    resp = client.get("/inbox", params={"tenant_id": "   "})
    assert resp.status_code == 400
