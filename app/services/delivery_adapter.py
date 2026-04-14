"""Delivery adapter for outbound humanized messages."""
from __future__ import annotations

import smtplib
from email.mime.text import MIMEText
from typing import Any

from app.services import audit_trail
from app.services.telegram.loop import send_telegram_message


_SUPPORTED_CHANNELS = {"telegram", "email"}


def deliver_messages(
    tenant_id: str,
    channel: str,
    messages: list[dict[str, Any]],
    dry_run: bool = False,
) -> dict[str, Any]:
    """Deliver (or preview) messages with strict recipient handling."""
    tenant_id_clean = _validate_tenant(tenant_id)
    channel_clean = _validate_channel(channel)
    if not isinstance(messages, list):
        raise ValueError("messages must be a list")

    results: list[dict[str, Any]] = []
    sent_count = 0
    failed_count = 0

    for idx, message in enumerate(messages):
        result = _process_single_message(
            tenant_id=tenant_id_clean,
            channel=channel_clean,
            message=message,
            message_index=idx,
            dry_run=dry_run,
        )
        results.append(result)
        if result["status"] == "sent":
            sent_count += 1
        elif result["status"] == "failed":
            failed_count += 1

    return {
        "tenant_id": tenant_id_clean,
        "channel": channel_clean,
        "dry_run": dry_run,
        "sent_count": sent_count,
        "failed_count": failed_count,
        "results": results,
    }


def _process_single_message(
    *,
    tenant_id: str,
    channel: str,
    message: Any,
    message_index: int,
    dry_run: bool,
) -> dict[str, Any]:
    if not isinstance(message, dict):
        result = _build_result(
            status="failed",
            channel=channel,
            recipient=None,
            message_text="",
            error=f"Message {message_index} is not a dict",
            recipient_used=None,
        )
        _audit_delivery_event(tenant_id, channel, message_index, result, dry_run)
        return result

    message_text = message.get("message_text")
    if not isinstance(message_text, str) or not message_text.strip():
        result = _build_result(
            status="failed",
            channel=channel,
            recipient=None,
            message_text="",
            error=f"Message {message_index} missing message_text",
            recipient_used=None,
        )
        _audit_delivery_event(tenant_id, channel, message_index, result, dry_run)
        return result

    recipient = _normalize_recipient(message.get("recipient"))
    text_clean = message_text.strip()

    if dry_run:
        result = _build_result(
            status="preview",
            channel=channel,
            recipient=recipient,
            message_text=text_clean,
            error=None,
            recipient_used=None,
        )
        _audit_delivery_event(tenant_id, channel, message_index, result, dry_run)
        return result

    if recipient is None:
        result = _build_result(
            status="failed",
            channel=channel,
            recipient=None,
            message_text=text_clean,
            error="recipient is required when dry_run is False",
            recipient_used=None,
        )
        _audit_delivery_event(tenant_id, channel, message_index, result, dry_run)
        return result

    if channel == "telegram":
        result = _deliver_telegram(text_clean, recipient)
    else:
        result = _deliver_email(text_clean, recipient)

    _audit_delivery_event(tenant_id, channel, message_index, result, dry_run)
    return result


def _validate_tenant(tenant_id: str) -> str:
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("tenant_id must be a non-empty string")
    return tenant_id.strip()


def _validate_channel(channel: str) -> str:
    if not isinstance(channel, str) or not channel.strip():
        raise ValueError("channel must be a non-empty string")
    normalized = channel.strip().lower()
    if normalized not in _SUPPORTED_CHANNELS:
        raise ValueError(f"Unsupported channel: {channel}. Use 'telegram' or 'email'")
    return normalized


def _normalize_recipient(raw_value: Any) -> str | None:
    if isinstance(raw_value, str) and raw_value.strip():
        return raw_value.strip()
    return None


def _deliver_telegram(message_text: str, recipient: str) -> dict[str, Any]:
    """Send via Telegram adapter.

    Current Telegram adapter does not support explicit recipient routing.
    We keep recipient for traceability and mark recipient_used=False.
    """
    try:
        api_result = send_telegram_message(message_text)
        if isinstance(api_result, dict) and api_result.get("ok") is True:
            return _build_result(
                status="sent",
                channel="telegram",
                recipient=recipient,
                message_text=message_text,
                error=None,
                recipient_used=False,
            )
        return _build_result(
            status="failed",
            channel="telegram",
            recipient=recipient,
            message_text=message_text,
            error=f"Telegram API error: {api_result}",
            recipient_used=False,
        )
    except Exception as exc:
        return _build_result(
            status="failed",
            channel="telegram",
            recipient=recipient,
            message_text=message_text,
            error=str(exc),
            recipient_used=False,
        )


def _deliver_email(message_text: str, recipient: str) -> dict[str, Any]:
    try:
        import os

        smtp_host = os.getenv("SMTP_HOST", "localhost")
        smtp_port = int(os.getenv("SMTP_PORT", "25"))
        smtp_user = os.getenv("SMTP_USER", "")
        smtp_password = os.getenv("SMTP_PASSWORD", "")
        from_email = os.getenv("SMTP_FROM", "smartcounter@example.com")

        email_msg = MIMEText(message_text, "plain", "utf-8")
        email_msg["Subject"] = "SmartCounter Alert"
        email_msg["From"] = from_email
        email_msg["To"] = recipient

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            if smtp_user and smtp_password:
                server.login(smtp_user, smtp_password)
            server.send_message(email_msg)

        return _build_result(
            status="sent",
            channel="email",
            recipient=recipient,
            message_text=message_text,
            error=None,
            recipient_used=True,
        )
    except Exception as exc:
        return _build_result(
            status="failed",
            channel="email",
            recipient=recipient,
            message_text=message_text,
            error=str(exc),
            recipient_used=True,
        )


def _build_result(
    *,
    status: str,
    channel: str,
    recipient: str | None,
    message_text: str,
    error: str | None,
    recipient_used: bool | None,
) -> dict[str, Any]:
    return {
        "status": status,
        "channel": channel,
        "recipient": recipient,
        "message_text": message_text,
        "error": error,
        "recipient_used": recipient_used,
    }


def _audit_delivery_event(
    tenant_id: str,
    channel: str,
    message_index: int,
    result: dict[str, Any],
    dry_run: bool,
) -> None:
    event_type = "delivery_preview_generated" if dry_run else "delivery_sent"
    if result.get("status") == "failed":
        event_type = "delivery_failed"

    try:
        audit_trail.log_job_event(
            job_id=f"delivery_{tenant_id}",
            event_type=event_type,
            payload={
                "tenant_id": tenant_id,
                "channel": channel,
                "message_index": message_index,
                "status": result.get("status"),
                "recipient": result.get("recipient"),
                "recipient_used": result.get("recipient_used"),
                "error": result.get("error"),
            },
        )
    except Exception:
        # Audit logging must not break delivery.
        pass
