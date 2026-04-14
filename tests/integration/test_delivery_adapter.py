"""Integration tests for Delivery Adapter v1."""

import shutil
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services import audit_trail as at
from app.services import delivery_adapter as da


@pytest.fixture()
def isolated_test_env(monkeypatch):
    base_dir = Path(".tmp_delivery_tests")
    base_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = base_dir / f"delivery_test_{uuid.uuid4().hex}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(at, "_DB_PATH", tmp_dir / "audit.db")
    yield tmp_dir
    shutil.rmtree(tmp_dir, ignore_errors=True)


def test_dry_run_telegram_preview_with_recipient_present() -> None:
    result = da.deliver_messages(
        tenant_id="tenant_a",
        channel="telegram",
        messages=[{"message_text": "Hola", "recipient": "operator_1"}],
        dry_run=True,
    )
    assert result["dry_run"] is True
    assert result["sent_count"] == 0
    assert result["failed_count"] == 0
    assert result["results"][0]["status"] == "preview"
    assert result["results"][0]["recipient"] == "operator_1"


def test_dry_run_email_preview_with_recipient_none(isolated_test_env) -> None:
    tenant = "tenant_b"
    result = da.deliver_messages(
        tenant_id=tenant,
        channel="email",
        messages=[{"message_text": "Preview email", "recipient": None}],
        dry_run=True,
    )
    assert result["results"][0]["status"] == "preview"
    assert result["results"][0]["recipient"] is None

    events = at.get_job_events(f"delivery_{tenant}")
    assert len(events) == 1
    assert events[0]["event_type"] == "delivery_preview_generated"


def test_send_real_without_recipient_fails(isolated_test_env) -> None:
    tenant = "tenant_c"
    result = da.deliver_messages(
        tenant_id=tenant,
        channel="email",
        messages=[{"message_text": "Sin recipient"}],
        dry_run=False,
    )
    assert result["sent_count"] == 0
    assert result["failed_count"] == 1
    assert result["results"][0]["status"] == "failed"
    assert result["results"][0]["recipient"] is None
    assert "recipient is required" in str(result["results"][0]["error"])

    events = at.get_job_events(f"delivery_{tenant}")
    assert len(events) == 1
    assert events[0]["event_type"] == "delivery_failed"
    assert events[0]["payload"]["recipient"] is None


def test_audit_trail_records_preview_generated(isolated_test_env) -> None:
    tenant = "tenant_d"
    da.deliver_messages(
        tenant_id=tenant,
        channel="telegram",
        messages=[{"message_text": "Preview", "recipient": "rcp"}],
        dry_run=True,
    )
    events = at.get_job_events(f"delivery_{tenant}")
    assert len(events) == 1
    assert events[0]["event_type"] == "delivery_preview_generated"


def test_audit_trail_records_delivery_sent(isolated_test_env) -> None:
    tenant = "tenant_e"
    with patch("app.services.delivery_adapter.send_telegram_message") as mock_send:
        mock_send.return_value = {"ok": True}
        result = da.deliver_messages(
            tenant_id=tenant,
            channel="telegram",
            messages=[{"message_text": "Send", "recipient": "user123"}],
            dry_run=False,
        )

    assert result["results"][0]["status"] == "sent"
    assert result["results"][0]["recipient_used"] is False
    events = at.get_job_events(f"delivery_{tenant}")
    assert len(events) == 1
    assert events[0]["event_type"] == "delivery_sent"
    assert events[0]["payload"]["recipient_used"] is False


def test_audit_trail_records_delivery_failed(isolated_test_env) -> None:
    tenant = "tenant_f"
    with patch("app.services.delivery_adapter.smtplib.SMTP") as mock_smtp:
        mock_smtp.side_effect = Exception("SMTP down")
        result = da.deliver_messages(
            tenant_id=tenant,
            channel="email",
            messages=[{"message_text": "Email fail", "recipient": "user@example.com"}],
            dry_run=False,
        )
    assert result["results"][0]["status"] == "failed"
    events = at.get_job_events(f"delivery_{tenant}")
    assert len(events) == 1
    assert events[0]["event_type"] == "delivery_failed"
    assert "SMTP down" in str(events[0]["payload"]["error"])


def test_invalid_channel_raises_value_error() -> None:
    with pytest.raises(ValueError, match="Unsupported channel"):
        da.deliver_messages(
            tenant_id="tenant_g",
            channel="invalid",
            messages=[],
            dry_run=True,
        )


def test_invalid_tenant_raises_value_error() -> None:
    with pytest.raises(ValueError, match="tenant_id must be a non-empty string"):
        da.deliver_messages(
            tenant_id="   ",
            channel="telegram",
            messages=[],
            dry_run=True,
        )


def test_output_is_deterministic() -> None:
    messages = [
        {"message_text": "Deterministico", "recipient": "r1"},
        {"message_text": "Deterministico 2", "recipient": None},
    ]
    first = da.deliver_messages("tenant_h", "email", messages, dry_run=True)
    second = da.deliver_messages("tenant_h", "email", messages, dry_run=True)
    assert first == second


def test_does_not_invent_default_recipient(isolated_test_env) -> None:
    with patch("app.services.delivery_adapter.smtplib.SMTP") as mock_smtp:
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server
        result = da.deliver_messages(
            tenant_id="tenant_i",
            channel="email",
            messages=[{"message_text": "Sin inventar", "recipient": None}],
            dry_run=False,
        )
    assert result["results"][0]["status"] == "failed"
    assert result["results"][0]["recipient"] is None
    mock_smtp.assert_not_called()
