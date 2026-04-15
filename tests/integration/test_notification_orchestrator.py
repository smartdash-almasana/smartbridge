"""Integration tests for Notification Orchestrator v1."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.services import audit_trail as at
from app.services import notification_orchestrator as no_


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_db(monkeypatch):
    base_dir = Path(".tmp_orchestrator_tests")
    base_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = base_dir / f"orch_{uuid.uuid4().hex}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(at, "_DB_PATH", tmp_dir / "audit.db")
    yield tmp_dir
    shutil.rmtree(tmp_dir, ignore_errors=True)


def _make_item(urgency: str, idx: int = 0, recipient: str | None = None) -> dict[str, Any]:
    return {
        "kind": "finding",
        "urgency": urgency,
        "summary": f"Summary {urgency} {idx}",
        "title": f"Title {urgency} {idx}",
        "action_required": urgency == "alta",
        "entity_ref": f"entity_{idx}",
        "job_id": f"job_{idx}",
        "created_at": "2026-01-01T00:00:00+00:00",
        "recipient": recipient,
    }


def _inbox_with_items(tenant_id: str, items: list[dict]) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "counts": {"priority_items": len(items)},
        "priority_items": items,
        "pending_actions": [],
        "recent_findings": [],
        "recent_messages": [],
        "pending_clarifications": [],
    }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_invalid_tenant_raises() -> None:
    with pytest.raises(ValueError, match="tenant_id must be a non-empty string"):
        no_.orchestrate_notifications("   ")


def test_empty_tenant_raises() -> None:
    with pytest.raises(ValueError, match="tenant_id must be a non-empty string"):
        no_.orchestrate_notifications("")


def test_invalid_limit_zero_raises() -> None:
    with pytest.raises(ValueError, match="limit must be a positive integer"):
        no_.orchestrate_notifications("tenant_x", limit=0)


def test_invalid_limit_negative_raises() -> None:
    with pytest.raises(ValueError, match="limit must be a positive integer"):
        no_.orchestrate_notifications("tenant_x", limit=-1)


# ---------------------------------------------------------------------------
# Empty inbox
# ---------------------------------------------------------------------------

def test_empty_inbox_returns_stable_structure(isolated_db) -> None:
    tenant = "tenant_empty"
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox:
        mock_inbox.return_value = _inbox_with_items(tenant, [])
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    assert result["tenant_id"] == tenant
    assert result["dry_run"] is True
    assert result["selected_count"] == 0
    assert result["skipped_count"] == 0
    assert result["deliveries"] == []
    assert result["skipped"] == []


# ---------------------------------------------------------------------------
# Channel routing
# ---------------------------------------------------------------------------

def test_alta_goes_to_telegram(isolated_db) -> None:
    tenant = "tenant_alta"
    items = [_make_item("alta", 0)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "failed_count": 0, "results": []}
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    calls = {call.kwargs["channel"]: call for call in mock_deliver.call_args_list}
    assert "telegram" in calls
    assert "email" not in calls
    assert result["selected_count"] == 1
    assert result["skipped_count"] == 0


def test_media_goes_to_email(isolated_db) -> None:
    tenant = "tenant_media"
    items = [_make_item("media", 0)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "failed_count": 0, "results": []}
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    calls = {call.kwargs["channel"]: call for call in mock_deliver.call_args_list}
    assert "email" in calls
    assert "telegram" not in calls
    assert result["selected_count"] == 1


def test_baja_is_skipped(isolated_db) -> None:
    tenant = "tenant_baja"
    items = [_make_item("baja", 0)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    mock_deliver.assert_not_called()
    assert result["selected_count"] == 0
    assert result["skipped_count"] == 1
    assert "baja" in result["skipped"][0]["reason"]


# ---------------------------------------------------------------------------
# Limit
# ---------------------------------------------------------------------------

def test_respects_limit(isolated_db) -> None:
    """limit is the outer bound of candidates considered.

    With limit=1 only 1 item is passed to the policy, so selected_count=1
    regardless of channel caps.
    """
    tenant = "tenant_limit"
    items = [_make_item("alta", i) for i in range(10)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "failed_count": 0, "results": []}
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=1)

    # limit=1 → only 1 candidate considered → 1 selected (telegram cap not reached)
    assert result["selected_count"] == 1
    assert mock_deliver.call_count == 1
    passed_messages = mock_deliver.call_args.kwargs["messages"]
    assert len(passed_messages) == 1


# ---------------------------------------------------------------------------
# Priority order
# ---------------------------------------------------------------------------

def test_maintains_priority_order(isolated_db) -> None:
    tenant = "tenant_order"
    items = [
        _make_item("alta", 0),
        _make_item("media", 1),
        _make_item("alta", 2),
    ]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "failed_count": 0, "results": []}
        no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    # telegram call should have messages for item[0] and item[2] in original order
    # (telegram cap=2, both alta items fit)
    tg_call = next(c for c in mock_deliver.call_args_list if c.kwargs["channel"] == "telegram")
    tg_messages = tg_call.kwargs["messages"]
    assert tg_messages[0]["message_text"] == "Summary alta 0"
    assert tg_messages[1]["message_text"] == "Summary alta 2"


# ---------------------------------------------------------------------------
# Channel grouping
# ---------------------------------------------------------------------------

def test_groups_by_channel_single_call(isolated_db) -> None:
    """All alta items go to telegram in ONE call (capped at 2 by policy)."""
    tenant = "tenant_group"
    items = [_make_item("alta", i) for i in range(3)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    # Policy cap for telegram = 2, so only 2 of 3 items reach deliver_messages
    assert mock_deliver.call_count == 1
    assert mock_deliver.call_args.kwargs["channel"] == "telegram"
    assert len(mock_deliver.call_args.kwargs["messages"]) == 2
    # 1 skipped by cap
    assert result["skipped_count"] == 1


def test_two_channels_two_calls(isolated_db) -> None:
    tenant = "tenant_two_ch"
    items = [_make_item("alta", 0), _make_item("media", 1)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    assert mock_deliver.call_count == 2
    channels = {c.kwargs["channel"] for c in mock_deliver.call_args_list}
    assert channels == {"telegram", "email"}


# ---------------------------------------------------------------------------
# Recipient
# ---------------------------------------------------------------------------

def test_does_not_invent_recipient(isolated_db) -> None:
    tenant = "tenant_norecipient"
    items = [_make_item("alta", 0, recipient=None)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    passed_messages = mock_deliver.call_args.kwargs["messages"]
    assert passed_messages[0]["recipient"] is None


def test_uses_explicit_recipient_when_present(isolated_db) -> None:
    tenant = "tenant_hasrecipient"
    items = [_make_item("alta", 0, recipient="op_channel_123")]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    passed_messages = mock_deliver.call_args.kwargs["messages"]
    assert passed_messages[0]["recipient"] == "op_channel_123"


# ---------------------------------------------------------------------------
# dry_run propagation
# ---------------------------------------------------------------------------

def test_dry_run_true_propagates(isolated_db) -> None:
    tenant = "tenant_dryrun"
    items = [_make_item("alta", 0)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    assert mock_deliver.call_args.kwargs["dry_run"] is True
    assert result["dry_run"] is True


def test_dry_run_false_propagates(isolated_db) -> None:
    tenant = "tenant_nodryrun"
    items = [_make_item("media", 0)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        result = no_.orchestrate_notifications(tenant, dry_run=False, limit=3)

    assert mock_deliver.call_args.kwargs["dry_run"] is False
    assert result["dry_run"] is False


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

def test_output_is_deterministic(isolated_db) -> None:
    tenant = "tenant_det"
    items = [_make_item("alta", 0), _make_item("baja", 1)]
    with patch("app.services.notification_orchestrator.get_operational_inbox") as mock_inbox, \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_inbox.return_value = _inbox_with_items(tenant, items)
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        r1 = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)
        r2 = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    # Structure keys and counts must be identical
    assert r1["selected_count"] == r2["selected_count"]
    assert r1["skipped_count"] == r2["skipped_count"]
    assert len(r1["deliveries"]) == len(r2["deliveries"])
    assert len(r1["skipped"]) == len(r2["skipped"])


# ---------------------------------------------------------------------------
# No side-effects on business state
# ---------------------------------------------------------------------------

def test_does_not_touch_action_engine(isolated_db) -> None:
    """Orchestrator must not import or call action_engine."""
    import app.services.notification_orchestrator as orch_module
    source = open(orch_module.__file__).read()
    assert "action_engine" not in source


def test_does_not_mutate_findings_or_confirmations(isolated_db) -> None:
    """Orchestrator must not import confirmation_layer or modify findings."""
    import app.services.notification_orchestrator as orch_module
    source = open(orch_module.__file__).read()
    assert "confirmation_layer" not in source
    assert "findings_engine" not in source
