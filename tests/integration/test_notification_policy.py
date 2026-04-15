"""Integration tests for Notification Policy v1."""
from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from app.services import notification_policy as np_


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _item(urgency: str, summary: str = "", idx: int = 0) -> dict[str, Any]:
    return {
        "kind": "finding",
        "urgency": urgency,
        "summary": summary or f"Summary {urgency} {idx}",
        "title": f"Title {urgency} {idx}",
        "action_required": urgency == "alta",
        "entity_ref": f"entity_{idx}",
        "job_id": f"job_{idx}",
        "created_at": "2026-01-01T00:00:00+00:00",
    }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_invalid_limit_zero_raises() -> None:
    with pytest.raises(ValueError, match="limit must be a positive integer"):
        np_.apply_notification_policy([], limit=0)


def test_invalid_limit_negative_raises() -> None:
    with pytest.raises(ValueError, match="limit must be a positive integer"):
        np_.apply_notification_policy([], limit=-5)


def test_invalid_items_type_raises() -> None:
    with pytest.raises(ValueError, match="priority_items must be a list"):
        np_.apply_notification_policy(None, limit=3)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Empty input → stable structure
# ---------------------------------------------------------------------------

def test_empty_items_returns_stable_structure() -> None:
    result = np_.apply_notification_policy([], limit=3)
    assert result["selected_by_channel"]["telegram"] == []
    assert result["selected_by_channel"]["email"] == []
    assert result["skipped"] == []


# ---------------------------------------------------------------------------
# Eligibility: alta/media → selected, baja → skipped
# ---------------------------------------------------------------------------

def test_alta_is_eligible() -> None:
    result = np_.apply_notification_policy([_item("alta")], limit=5)
    assert len(result["selected_by_channel"]["telegram"]) == 1
    assert result["skipped"] == []


def test_media_is_eligible() -> None:
    result = np_.apply_notification_policy([_item("media")], limit=5)
    assert len(result["selected_by_channel"]["email"]) == 1
    assert result["skipped"] == []


def test_baja_is_skipped() -> None:
    result = np_.apply_notification_policy([_item("baja")], limit=5)
    assert result["selected_by_channel"]["telegram"] == []
    assert result["selected_by_channel"]["email"] == []
    assert len(result["skipped"]) == 1
    assert "baja" in result["skipped"][0]["reason"]


def test_unknown_urgency_is_skipped() -> None:
    item = _item("alta")
    item["urgency"] = "critical"
    result = np_.apply_notification_policy([item], limit=5)
    assert result["selected_by_channel"]["telegram"] == []
    assert len(result["skipped"]) == 1


# ---------------------------------------------------------------------------
# Channel caps
# ---------------------------------------------------------------------------

def test_telegram_cap_is_2() -> None:
    items = [_item("alta", idx=i) for i in range(5)]
    result = np_.apply_notification_policy(items, limit=10)
    assert len(result["selected_by_channel"]["telegram"]) == 2
    cap_skipped = [s for s in result["skipped"] if "cap" in s["reason"]]
    assert len(cap_skipped) == 3


def test_email_cap_is_3() -> None:
    items = [_item("media", idx=i) for i in range(6)]
    result = np_.apply_notification_policy(items, limit=10)
    assert len(result["selected_by_channel"]["email"]) == 3
    cap_skipped = [s for s in result["skipped"] if "cap" in s["reason"]]
    assert len(cap_skipped) == 3


def test_telegram_and_email_caps_are_independent() -> None:
    items = (
        [_item("alta", idx=i) for i in range(3)]
        + [_item("media", idx=i) for i in range(4)]
    )
    result = np_.apply_notification_policy(items, limit=10)
    assert len(result["selected_by_channel"]["telegram"]) == 2
    assert len(result["selected_by_channel"]["email"]) == 3


# ---------------------------------------------------------------------------
# Intra-run deduplication by summary + channel
# ---------------------------------------------------------------------------

def test_duplicate_summary_same_channel_skipped() -> None:
    items = [
        _item("alta", summary="Same summary"),
        _item("alta", summary="Same summary"),
    ]
    result = np_.apply_notification_policy(items, limit=5)
    assert len(result["selected_by_channel"]["telegram"]) == 1
    dup_skipped = [s for s in result["skipped"] if "duplicate" in s["reason"]]
    assert len(dup_skipped) == 1


def test_same_summary_different_channel_not_deduped() -> None:
    """Same summary text on different channels (alta→telegram, media→email) is allowed."""
    items = [
        _item("alta", summary="Overlap"),
        _item("media", summary="Overlap"),
    ]
    result = np_.apply_notification_policy(items, limit=5)
    assert len(result["selected_by_channel"]["telegram"]) == 1
    assert len(result["selected_by_channel"]["email"]) == 1
    assert result["skipped"] == []


def test_different_summaries_same_channel_not_deduped() -> None:
    items = [
        _item("alta", summary="A", idx=0),
        _item("alta", summary="B", idx=1),
    ]
    result = np_.apply_notification_policy(items, limit=5)
    assert len(result["selected_by_channel"]["telegram"]) == 2
    assert result["skipped"] == []


# ---------------------------------------------------------------------------
# Overall limit (outer bound)
# ---------------------------------------------------------------------------

def test_limit_outer_bound() -> None:
    """limit=2 means at most 2 candidates are even considered."""
    items = [_item("alta", idx=i) for i in range(10)]
    result = np_.apply_notification_policy(items, limit=2)
    # At most 2 candidates → at most 2 selected (telegram cap=2 wouldn't trigger)
    total_selected = sum(len(v) for v in result["selected_by_channel"].values())
    assert total_selected <= 2


def test_limit_1_selects_at_most_1() -> None:
    items = [_item("alta", idx=i) for i in range(5)]
    result = np_.apply_notification_policy(items, limit=1)
    total_selected = sum(len(v) for v in result["selected_by_channel"].values())
    assert total_selected == 1


# ---------------------------------------------------------------------------
# Maintains relative order of priority_items
# ---------------------------------------------------------------------------

def test_maintains_order_within_channel() -> None:
    items = [
        _item("alta", summary="First", idx=0),
        _item("alta", summary="Second", idx=1),
    ]
    result = np_.apply_notification_policy(items, limit=5)
    tg = result["selected_by_channel"]["telegram"]
    assert tg[0]["summary"] == "First"
    assert tg[1]["summary"] == "Second"


def test_maintains_relative_order_mixed_urgencies() -> None:
    items = [
        _item("alta", summary="A0", idx=0),
        _item("media", summary="M0", idx=1),
        _item("alta", summary="A1", idx=2),
        _item("media", summary="M1", idx=3),
    ]
    result = np_.apply_notification_policy(items, limit=10)
    tg = result["selected_by_channel"]["telegram"]
    em = result["selected_by_channel"]["email"]
    assert tg[0]["summary"] == "A0"
    assert tg[1]["summary"] == "A1"
    assert em[0]["summary"] == "M0"
    assert em[1]["summary"] == "M1"


# ---------------------------------------------------------------------------
# Skipped reasons are explicit
# ---------------------------------------------------------------------------

def test_all_skip_reasons_are_non_empty_strings() -> None:
    items = [
        _item("baja", idx=0),
        _item("alta", summary="dup", idx=1),
        _item("alta", summary="dup", idx=2),
    ] + [_item("alta", idx=i + 10) for i in range(5)]  # trigger cap
    result = np_.apply_notification_policy(items, limit=10)
    for entry in result["skipped"]:
        assert isinstance(entry["reason"], str)
        assert entry["reason"].strip() != ""
        assert isinstance(entry["item"], dict)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

def test_deterministic_same_input() -> None:
    items = [
        _item("alta", idx=0),
        _item("media", idx=1),
        _item("baja", idx=2),
    ]
    r1 = np_.apply_notification_policy(items, limit=5)
    r2 = np_.apply_notification_policy(items, limit=5)
    assert r1["selected_by_channel"] == r2["selected_by_channel"]
    assert [s["reason"] for s in r1["skipped"]] == [s["reason"] for s in r2["skipped"]]


# ---------------------------------------------------------------------------
# Orchestrator integration: policy is applied, contract unchanged
# ---------------------------------------------------------------------------

def _make_inbox(tenant: str, items: list[dict]) -> dict[str, Any]:
    return {
        "tenant_id": tenant,
        "priority_items": items,
        "pending_actions": [],
        "recent_findings": [],
        "recent_messages": [],
        "pending_clarifications": [],
        "counts": {"priority_items": len(items)},
    }


def test_orchestrator_baja_goes_to_skipped_via_policy() -> None:
    from app.services import notification_orchestrator as no_

    tenant = "tenant_policy_baja"
    items = [_item("baja", idx=0)]
    with patch("app.services.notification_orchestrator.get_operational_inbox",
               return_value=_make_inbox(tenant, items)), \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=5)

    mock_deliver.assert_not_called()
    assert result["selected_count"] == 0
    assert result["skipped_count"] == 1
    assert "baja" in result["skipped"][0]["reason"]


def test_orchestrator_channel_cap_respected_via_policy() -> None:
    from app.services import notification_orchestrator as no_

    tenant = "tenant_policy_cap"
    # 5 alta items → only 2 should reach telegram (cap=2)
    items = [_item("alta", idx=i) for i in range(5)]
    with patch("app.services.notification_orchestrator.get_operational_inbox",
               return_value=_make_inbox(tenant, items)), \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=10)

    assert mock_deliver.call_count == 1
    assert mock_deliver.call_args.kwargs["channel"] == "telegram"
    assert len(mock_deliver.call_args.kwargs["messages"]) == 2
    # 3 should be in skipped (cap)
    assert result["skipped_count"] == 3


def test_orchestrator_dedup_via_policy() -> None:
    from app.services import notification_orchestrator as no_

    tenant = "tenant_policy_dedup"
    items = [
        _item("alta", summary="Same msg"),
        _item("alta", summary="Same msg"),
    ]
    with patch("app.services.notification_orchestrator.get_operational_inbox",
               return_value=_make_inbox(tenant, items)), \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=5)

    # Only 1 sent
    assert result["selected_count"] == 1
    assert result["skipped_count"] == 1


def test_orchestrator_public_contract_unchanged() -> None:
    """orchestrate_notifications must still return the same top-level keys."""
    from app.services import notification_orchestrator as no_

    tenant = "tenant_contract"
    with patch("app.services.notification_orchestrator.get_operational_inbox",
               return_value=_make_inbox(tenant, [])):
        result = no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    required_keys = {"tenant_id", "dry_run", "selected_count", "skipped_count",
                     "deliveries", "skipped"}
    assert required_keys.issubset(result.keys())
    assert result["tenant_id"] == tenant
