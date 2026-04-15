"""Integration tests for Recipient Resolution v1."""
from __future__ import annotations

import pytest

from app.services import recipient_resolution as rr


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_empty_tenant_raises() -> None:
    with pytest.raises(ValueError, match="tenant_id must be a non-empty string"):
        rr.resolve_recipient("", "telegram")


def test_whitespace_tenant_raises() -> None:
    with pytest.raises(ValueError, match="tenant_id must be a non-empty string"):
        rr.resolve_recipient("   ", "telegram")


def test_unsupported_channel_raises() -> None:
    with pytest.raises(ValueError, match="Unsupported channel"):
        rr.resolve_recipient("tenant_x", "whatsapp")


def test_empty_channel_raises() -> None:
    with pytest.raises(ValueError, match="channel must be a non-empty string"):
        rr.resolve_recipient("tenant_x", "")


# ---------------------------------------------------------------------------
# No env configured → None (never invent)
# ---------------------------------------------------------------------------

def test_no_env_telegram_returns_none(monkeypatch) -> None:
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    monkeypatch.delenv("TENANT_ACME_TELEGRAM_RECIPIENT", raising=False)
    result = rr.resolve_recipient("acme", "telegram")
    assert result is None


def test_no_env_email_returns_none(monkeypatch) -> None:
    monkeypatch.delenv("TENANT_ACME_EMAIL_RECIPIENT", raising=False)
    result = rr.resolve_recipient("acme", "email")
    assert result is None


# ---------------------------------------------------------------------------
# Tenant-specific env var (highest priority)
# ---------------------------------------------------------------------------

def test_tenant_specific_telegram_env(monkeypatch) -> None:
    monkeypatch.setenv("TENANT_ACME_TELEGRAM_RECIPIENT", "987654321")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "000000000")
    result = rr.resolve_recipient("acme", "telegram")
    # Tenant-specific wins over channel default
    assert result == "987654321"


def test_tenant_specific_email_env(monkeypatch) -> None:
    monkeypatch.setenv("TENANT_ACME_EMAIL_RECIPIENT", "ops@acme.com")
    result = rr.resolve_recipient("acme", "email")
    assert result == "ops@acme.com"


def test_tenant_id_case_insensitive_in_env_key(monkeypatch) -> None:
    """Tenant IDs are uppercased when building the env key."""
    monkeypatch.setenv("TENANT_MYSTORE_TELEGRAM_RECIPIENT", "111222333")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    result = rr.resolve_recipient("MyStore", "telegram")
    assert result == "111222333"


def test_tenant_id_special_chars_sanitized(monkeypatch) -> None:
    """Non-alphanumeric chars in tenant_id become underscores in env key."""
    monkeypatch.setenv("TENANT_MY_STORE_TELEGRAM_RECIPIENT", "555666777")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    result = rr.resolve_recipient("my-store", "telegram")
    assert result == "555666777"


# ---------------------------------------------------------------------------
# Channel-level default (telegram only)
# ---------------------------------------------------------------------------

def test_telegram_falls_back_to_chat_id(monkeypatch) -> None:
    monkeypatch.delenv("TENANT_ACME_TELEGRAM_RECIPIENT", raising=False)
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "123456789")
    result = rr.resolve_recipient("acme", "telegram")
    assert result == "123456789"


def test_email_does_not_fall_back_to_telegram_chat_id(monkeypatch) -> None:
    """Email must not inherit TELEGRAM_CHAT_ID as a recipient."""
    monkeypatch.delenv("TENANT_ACME_EMAIL_RECIPIENT", raising=False)
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "123456789")
    result = rr.resolve_recipient("acme", "email")
    assert result is None


# ---------------------------------------------------------------------------
# Whitespace trimming
# ---------------------------------------------------------------------------

def test_env_value_is_stripped(monkeypatch) -> None:
    monkeypatch.setenv("TENANT_ACME_EMAIL_RECIPIENT", "   ops@acme.com   ")
    result = rr.resolve_recipient("acme", "email")
    assert result == "ops@acme.com"


def test_whitespace_only_env_treated_as_missing(monkeypatch) -> None:
    monkeypatch.setenv("TENANT_ACME_EMAIL_RECIPIENT", "   ")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    result = rr.resolve_recipient("acme", "email")
    assert result is None


# ---------------------------------------------------------------------------
# Channel normalization
# ---------------------------------------------------------------------------

def test_channel_case_insensitive(monkeypatch) -> None:
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "999")
    monkeypatch.delenv("TENANT_ACME_TELEGRAM_RECIPIENT", raising=False)
    result = rr.resolve_recipient("acme", "Telegram")
    assert result == "999"


# ---------------------------------------------------------------------------
# Tenant isolation — different tenants get different recipients
# ---------------------------------------------------------------------------

def test_tenant_isolation(monkeypatch) -> None:
    monkeypatch.setenv("TENANT_T1_EMAIL_RECIPIENT", "t1@example.com")
    monkeypatch.setenv("TENANT_T2_EMAIL_RECIPIENT", "t2@example.com")
    r1 = rr.resolve_recipient("t1", "email")
    r2 = rr.resolve_recipient("t2", "email")
    assert r1 == "t1@example.com"
    assert r2 == "t2@example.com"
    assert r1 != r2


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

def test_deterministic_for_same_inputs(monkeypatch) -> None:
    monkeypatch.setenv("TENANT_ACME_EMAIL_RECIPIENT", "ops@acme.com")
    r1 = rr.resolve_recipient("acme", "email")
    r2 = rr.resolve_recipient("acme", "email")
    assert r1 == r2


# ---------------------------------------------------------------------------
# describe_resolution (diagnostic helper)
# ---------------------------------------------------------------------------

def test_describe_resolution_resolved(monkeypatch) -> None:
    monkeypatch.setenv("TENANT_ACME_TELEGRAM_RECIPIENT", "111")
    info = rr.describe_resolution("acme", "telegram")
    assert info["resolved"] is True
    assert info["recipient"] == "111"
    assert "TENANT_ACME_TELEGRAM_RECIPIENT" in str(info["source"])


def test_describe_resolution_not_resolved(monkeypatch) -> None:
    monkeypatch.delenv("TENANT_ACME_EMAIL_RECIPIENT", raising=False)
    info = rr.describe_resolution("acme", "email")
    assert info["resolved"] is False
    assert info["recipient"] is None
    assert info["source"] is None


def test_describe_resolution_never_raises() -> None:
    """describe_resolution must not raise even on bad input."""
    info = rr.describe_resolution("", "bad_channel")
    assert "error" in info or info["resolved"] is False


# ---------------------------------------------------------------------------
# Integration: orchestrator uses resolve_recipient
# ---------------------------------------------------------------------------

def test_orchestrator_uses_resolve_recipient_for_telegram(monkeypatch) -> None:
    """When item has no recipient field, orchestrator delegates to resolve_recipient."""
    from unittest.mock import patch
    from app.services import notification_orchestrator as no_

    tenant = "tenant_rr_int"
    monkeypatch.setenv("TENANT_TENANT_RR_INT_TELEGRAM_RECIPIENT", "resolved_chat")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)

    item = {
        "urgency": "alta",
        "summary": "Summary alta",
        "title": "Title alta",
        "entity_ref": "some_entity",
        "job_id": "job_1",
        "created_at": "2026-01-01T00:00:00+00:00",
        # No "recipient" field
    }
    inbox = {
        "tenant_id": tenant,
        "priority_items": [item],
        "pending_actions": [],
        "recent_findings": [],
        "recent_messages": [],
        "pending_clarifications": [],
        "counts": {"priority_items": 1},
    }

    with patch("app.services.notification_orchestrator.get_operational_inbox", return_value=inbox), \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    passed_messages = mock_deliver.call_args.kwargs["messages"]
    assert passed_messages[0]["recipient"] == "resolved_chat"


def test_orchestrator_item_recipient_wins_over_resolve(monkeypatch) -> None:
    """Explicit recipient on item takes priority over resolve_recipient."""
    from unittest.mock import patch
    from app.services import notification_orchestrator as no_

    tenant = "tenant_rr_prio"
    monkeypatch.setenv("TENANT_TENANT_RR_PRIO_TELEGRAM_RECIPIENT", "env_chat")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)

    item = {
        "urgency": "alta",
        "summary": "Summary",
        "recipient": "item_explicit_chat",
        "entity_ref": "e",
        "job_id": "j1",
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    inbox = {
        "tenant_id": tenant,
        "priority_items": [item],
        "pending_actions": [],
        "recent_findings": [],
        "recent_messages": [],
        "pending_clarifications": [],
        "counts": {},
    }

    with patch("app.services.notification_orchestrator.get_operational_inbox", return_value=inbox), \
         patch("app.services.notification_orchestrator.deliver_messages") as mock_deliver:
        mock_deliver.return_value = {"sent_count": 0, "results": []}
        no_.orchestrate_notifications(tenant, dry_run=True, limit=3)

    passed_messages = mock_deliver.call_args.kwargs["messages"]
    assert passed_messages[0]["recipient"] == "item_explicit_chat"
