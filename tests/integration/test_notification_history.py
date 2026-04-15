"""Integration tests for Notification History v1."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

import pytest

from app.services import audit_trail as at
from app.services import notification_history as nh


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_db(monkeypatch):
    base_dir = Path(".tmp_history_tests")
    base_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = base_dir / f"hist_{uuid.uuid4().hex}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(at, "_DB_PATH", tmp_dir / "audit.db")
    yield tmp_dir
    shutil.rmtree(tmp_dir, ignore_errors=True)


def _log(job_id: str, event_type: str, payload: dict) -> None:
    at.log_job_event(job_id=job_id, event_type=event_type, payload=payload)


def _delivery_payload(tenant: str, **kwargs) -> dict:
    base = {
        "tenant_id": tenant,
        "channel": "telegram",
        "message_index": 0,
        "status": "preview",
        "recipient": "op_1",
        "recipient_used": False,
        "error": None,
    }
    base.update(kwargs)
    return base


def _orch_payload(tenant: str, **kwargs) -> dict:
    base = {
        "tenant_id": tenant,
        "dry_run": True,
        "limit": 3,
        "total_priority_items": 2,
    }
    base.update(kwargs)
    return base


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_empty_tenant_raises() -> None:
    with pytest.raises(ValueError, match="tenant_id must be a non-empty string"):
        nh.get_notification_history("")


def test_whitespace_tenant_raises() -> None:
    with pytest.raises(ValueError, match="tenant_id must be a non-empty string"):
        nh.get_notification_history("   ")


def test_limit_zero_raises() -> None:
    with pytest.raises(ValueError, match="limit must be a positive integer"):
        nh.get_notification_history("t1", limit=0)


def test_limit_negative_raises() -> None:
    with pytest.raises(ValueError, match="limit must be a positive integer"):
        nh.get_notification_history("t1", limit=-1)


# ---------------------------------------------------------------------------
# Empty / no events
# ---------------------------------------------------------------------------

def test_no_db_returns_stable_structure(isolated_db) -> None:
    result = nh.get_notification_history("tenant_x", limit=10)
    assert result["tenant_id"] == "tenant_x"
    assert result["count"] == 0
    assert result["items"] == []


def test_empty_db_returns_stable_structure(isolated_db) -> None:
    # Trigger table creation by writing an unrelated event, then query history.
    _log("some_job", "some_event", {"tenant_id": "other"})
    result = nh.get_notification_history("tenant_x", limit=10)
    assert result["count"] == 0
    assert result["items"] == []


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

def test_filters_by_tenant(isolated_db) -> None:
    t1 = "tenant_one"
    t2 = "tenant_two"
    _log(f"delivery_{t1}", "delivery_sent", _delivery_payload(t1, status="sent"))
    _log(f"delivery_{t2}", "delivery_sent", _delivery_payload(t2, status="sent"))

    r1 = nh.get_notification_history(t1, limit=10)
    r2 = nh.get_notification_history(t2, limit=10)

    assert r1["count"] == 1
    assert r2["count"] == 1
    assert r1["items"][0]["job_id"] == f"delivery_{t1}"
    assert r2["items"][0]["job_id"] == f"delivery_{t2}"


def test_does_not_leak_other_tenant_events(isolated_db) -> None:
    t_a = "alpha"
    t_b = "beta"
    _log(f"delivery_{t_a}", "delivery_sent", _delivery_payload(t_a))
    result = nh.get_notification_history(t_b, limit=10)
    assert result["count"] == 0


def test_payload_tenant_id_mismatch_excluded(isolated_db) -> None:
    """Even if job_id prefix matches, mismatched payload.tenant_id must be excluded."""
    tenant = "myten"
    # job_id looks like delivery_myten but payload says it belongs to 'otherten'
    _log(f"delivery_{tenant}", "delivery_sent", _delivery_payload("otherten"))
    result = nh.get_notification_history(tenant, limit=10)
    assert result["count"] == 0


# ---------------------------------------------------------------------------
# Event type filtering: only notification events included
# ---------------------------------------------------------------------------

def test_non_notification_events_excluded(isolated_db) -> None:
    tenant = "myten2"
    _log(f"delivery_{tenant}", "draft_created", {"tenant_id": tenant})  # unrelated
    _log(f"delivery_{tenant}", "delivery_sent", _delivery_payload(tenant, status="sent"))

    result = nh.get_notification_history(tenant, limit=10)
    assert result["count"] == 1
    assert result["items"][0]["event_type"] == "delivery_sent"


# ---------------------------------------------------------------------------
# Status mapping
# ---------------------------------------------------------------------------

def test_delivery_preview_maps_to_preview(isolated_db) -> None:
    tenant = "t_preview"
    _log(f"delivery_{tenant}", "delivery_preview_generated", _delivery_payload(tenant))
    result = nh.get_notification_history(tenant, limit=10)
    assert result["items"][0]["status"] == "preview"
    assert result["items"][0]["event_type"] == "delivery_preview_generated"


def test_delivery_sent_maps_to_sent(isolated_db) -> None:
    tenant = "t_sent"
    _log(f"delivery_{tenant}", "delivery_sent", _delivery_payload(tenant, status="sent"))
    result = nh.get_notification_history(tenant, limit=10)
    assert result["items"][0]["status"] == "sent"


def test_delivery_failed_maps_to_failed(isolated_db) -> None:
    tenant = "t_failed"
    _log(
        f"delivery_{tenant}",
        "delivery_failed",
        _delivery_payload(tenant, status="failed", error="SMTP down"),
    )
    result = nh.get_notification_history(tenant, limit=10)
    item = result["items"][0]
    assert item["status"] == "failed"
    assert item["error"] == "SMTP down"


# ---------------------------------------------------------------------------
# Orchestration events included with status=None
# ---------------------------------------------------------------------------

def test_orchestration_started_included(isolated_db) -> None:
    tenant = "t_orch"
    _log(
        f"orchestration_{tenant}",
        "notification_orchestration_started",
        _orch_payload(tenant),
    )
    result = nh.get_notification_history(tenant, limit=10)
    assert result["count"] == 1
    assert result["items"][0]["event_type"] == "notification_orchestration_started"
    assert result["items"][0]["status"] is None


def test_orchestration_completed_included(isolated_db) -> None:
    tenant = "t_orch2"
    _log(
        f"orchestration_{tenant}",
        "notification_orchestration_completed",
        _orch_payload(tenant),
    )
    result = nh.get_notification_history(tenant, limit=10)
    assert result["count"] == 1
    assert result["items"][0]["status"] is None


# ---------------------------------------------------------------------------
# Fields projected correctly
# ---------------------------------------------------------------------------

def test_channel_projected(isolated_db) -> None:
    tenant = "t_ch"
    _log(f"delivery_{tenant}", "delivery_sent",
         _delivery_payload(tenant, channel="email", status="sent"))
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["channel"] == "email"


def test_recipient_projected(isolated_db) -> None:
    tenant = "t_rcp"
    _log(f"delivery_{tenant}", "delivery_sent",
         _delivery_payload(tenant, recipient="user@x.com"))
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["recipient"] == "user@x.com"


def test_recipient_none_projected(isolated_db) -> None:
    tenant = "t_rcp_none"
    _log(f"delivery_{tenant}", "delivery_preview_generated",
         _delivery_payload(tenant, recipient=None))
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["recipient"] is None


def test_recipient_used_bool_projected(isolated_db) -> None:
    tenant = "t_ru"
    _log(f"delivery_{tenant}", "delivery_sent",
         _delivery_payload(tenant, recipient_used=True, status="sent"))
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["recipient_used"] is True


def test_recipient_used_false_projected(isolated_db) -> None:
    tenant = "t_ru2"
    _log(f"delivery_{tenant}", "delivery_sent",
         _delivery_payload(tenant, recipient_used=False, status="sent"))
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["recipient_used"] is False


def test_job_id_projected(isolated_db) -> None:
    tenant = "t_jid"
    _log(f"delivery_{tenant}", "delivery_sent", _delivery_payload(tenant))
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["job_id"] == f"delivery_{tenant}"


def test_created_at_projected(isolated_db) -> None:
    tenant = "t_ts"
    _log(f"delivery_{tenant}", "delivery_sent", _delivery_payload(tenant))
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["created_at"] is not None
    assert len(item["created_at"]) > 0


# ---------------------------------------------------------------------------
# Ordering: most recent first, deterministic tie-break
# ---------------------------------------------------------------------------

def test_order_most_recent_first(isolated_db) -> None:
    tenant = "t_ord"
    _log(f"delivery_{tenant}", "delivery_sent",
         _delivery_payload(tenant, status="sent", recipient="first"))
    _log(f"delivery_{tenant}", "delivery_sent",
         _delivery_payload(tenant, status="sent", recipient="second"))
    _log(f"delivery_{tenant}", "delivery_sent",
         _delivery_payload(tenant, status="sent", recipient="third"))

    items = nh.get_notification_history(tenant, limit=10)["items"]
    assert len(items) == 3
    # Audit trail returns newest first (ORDER BY created_at DESC, id DESC)
    assert items[0]["recipient"] == "third"
    assert items[1]["recipient"] == "second"
    assert items[2]["recipient"] == "first"


def test_deterministic_ordering(isolated_db) -> None:
    tenant = "t_det"
    for i in range(5):
        _log(f"delivery_{tenant}", "delivery_sent",
             _delivery_payload(tenant, status="sent", recipient=f"r{i}"))
    r1 = nh.get_notification_history(tenant, limit=10)
    r2 = nh.get_notification_history(tenant, limit=10)
    assert [i["recipient"] for i in r1["items"]] == [i["recipient"] for i in r2["items"]]


# ---------------------------------------------------------------------------
# Limit respected
# ---------------------------------------------------------------------------

def test_limit_respected(isolated_db) -> None:
    tenant = "t_lim"
    for i in range(8):
        _log(f"orchestration_{tenant}", "notification_orchestration_started",
             _orch_payload(tenant))
    result = nh.get_notification_history(tenant, limit=3)
    assert result["count"] == 3
    assert len(result["items"]) == 3


# ---------------------------------------------------------------------------
# Tolerates incomplete / malformed payloads
# ---------------------------------------------------------------------------

def test_tolerates_missing_channel(isolated_db) -> None:
    tenant = "t_miss"
    _log(f"delivery_{tenant}", "delivery_sent", {"tenant_id": tenant})  # no channel
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["channel"] is None


def test_tolerates_missing_error(isolated_db) -> None:
    tenant = "t_miss2"
    _log(f"delivery_{tenant}", "delivery_failed", {"tenant_id": tenant})
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["error"] is None


def test_tolerates_missing_recipient_used(isolated_db) -> None:
    tenant = "t_miss3"
    _log(f"delivery_{tenant}", "delivery_sent", {"tenant_id": tenant})
    item = nh.get_notification_history(tenant, limit=10)["items"][0]
    assert item["recipient_used"] is None


# ---------------------------------------------------------------------------
# Mixed events: delivery + orchestration for same tenant
# ---------------------------------------------------------------------------

def test_mixed_event_types_for_same_tenant(isolated_db) -> None:
    tenant = "t_mix"
    _log(f"orchestration_{tenant}", "notification_orchestration_started",
         _orch_payload(tenant))
    _log(f"delivery_{tenant}", "delivery_preview_generated",
         _delivery_payload(tenant))
    _log(f"orchestration_{tenant}", "notification_orchestration_completed",
         _orch_payload(tenant))
    _log(f"delivery_{tenant}", "delivery_sent",
         _delivery_payload(tenant, status="sent"))

    result = nh.get_notification_history(tenant, limit=10)
    assert result["count"] == 4
    event_types = {i["event_type"] for i in result["items"]}
    assert "notification_orchestration_started" in event_types
    assert "notification_orchestration_completed" in event_types
    assert "delivery_preview_generated" in event_types
    assert "delivery_sent" in event_types


# ---------------------------------------------------------------------------
# Output structure is always complete
# ---------------------------------------------------------------------------

def test_output_keys_always_present(isolated_db) -> None:
    tenant = "t_keys"
    _log(f"delivery_{tenant}", "delivery_sent", _delivery_payload(tenant))
    result = nh.get_notification_history(tenant, limit=10)

    assert "tenant_id" in result
    assert "count" in result
    assert "items" in result

    item = result["items"][0]
    expected_keys = {
        "event_type", "channel", "status", "job_id",
        "recipient", "recipient_used", "error", "created_at",
    }
    assert expected_keys.issubset(item.keys())
