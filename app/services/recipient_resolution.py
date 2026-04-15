"""Recipient Resolution v1 — canonical, explicit, never invented.

Resolution order for each channel:

1. Tenant-specific env var:
       TENANT_<TENANT_ID_UPPER>_<CHANNEL_UPPER>_RECIPIENT
   Example: TENANT_ACME_TELEGRAM_RECIPIENT=123456789
            TENANT_ACME_EMAIL_RECIPIENT=ops@acme.com

2. Channel-level default env var (only for telegram, where a single chat_id
   is the normal deployment model):
       TELEGRAM_CHAT_ID  (existing env already used by the telegram adapter)

3. If nothing is found → return None.  Never invent a recipient.

Contract:
    resolve_recipient(tenant_id: str, channel: str) -> str | None

Callers (e.g. notification_orchestrator) should pass recipient=None to
deliver_messages when resolution returns None; the adapter handles that case.
"""
from __future__ import annotations

import os
from typing import Any


_SUPPORTED_CHANNELS = {"telegram", "email"}


def resolve_recipient(tenant_id: str, channel: str) -> str | None:
    """Return the correct recipient for *tenant_id* on *channel*, or None.

    Args:
        tenant_id: non-empty tenant identifier.
        channel:   'telegram' or 'email'.

    Returns:
        Resolved recipient string, or None if not configured.

    Raises:
        ValueError: if tenant_id is empty or channel is unsupported.
    """
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("tenant_id must be a non-empty string")
    channel_clean = _validate_channel(channel)
    tenant_clean = tenant_id.strip()

    # 1. Tenant-specific override
    specific = _tenant_specific_recipient(tenant_clean, channel_clean)
    if specific is not None:
        return specific

    # 2. Channel-level default (telegram only — single chat_id deployment model)
    if channel_clean == "telegram":
        return _telegram_default()

    # 3. No recipient found
    return None


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _validate_channel(channel: str) -> str:
    if not isinstance(channel, str) or not channel.strip():
        raise ValueError("channel must be a non-empty string")
    normalized = channel.strip().lower()
    if normalized not in _SUPPORTED_CHANNELS:
        raise ValueError(
            f"Unsupported channel: '{channel}'. Supported: {sorted(_SUPPORTED_CHANNELS)}"
        )
    return normalized


def _env_key(tenant_id: str, channel: str) -> str:
    """Build env var name: TENANT_<ID_UPPER>_<CHANNEL_UPPER>_RECIPIENT."""
    safe_tenant = _sanitize_env_segment(tenant_id)
    safe_channel = channel.upper()
    return f"TENANT_{safe_tenant}_{safe_channel}_RECIPIENT"


def _sanitize_env_segment(value: str) -> str:
    """Uppercase and replace non-alphanumeric chars with underscore."""
    result = []
    for ch in value.upper():
        result.append(ch if ch.isalnum() else "_")
    return "".join(result)


def _tenant_specific_recipient(tenant_id: str, channel: str) -> str | None:
    key = _env_key(tenant_id, channel)
    value = os.getenv(key, "").strip()
    return value if value else None


def _telegram_default() -> str | None:
    value = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    return value if value else None


def describe_resolution(tenant_id: str, channel: str) -> dict[str, Any]:
    """Return a diagnostic dict explaining how recipient was (or was not) resolved.

    Useful for dry-run previews and debugging — never raises.
    """
    try:
        channel_clean = _validate_channel(channel)
        tenant_clean = tenant_id.strip() if isinstance(tenant_id, str) else ""
        specific_key = _env_key(tenant_clean, channel_clean) if tenant_clean else ""
        specific_value = os.getenv(specific_key, "").strip() if specific_key else ""

        source: str | None = None
        recipient: str | None = None

        if specific_value:
            recipient = specific_value
            source = f"env:{specific_key}"
        elif channel_clean == "telegram":
            default = _telegram_default()
            if default:
                recipient = default
                source = "env:TELEGRAM_CHAT_ID"

        return {
            "tenant_id": tenant_clean,
            "channel": channel_clean,
            "recipient": recipient,
            "source": source,
            "resolved": recipient is not None,
        }
    except Exception as exc:
        return {
            "tenant_id": tenant_id,
            "channel": channel,
            "recipient": None,
            "source": None,
            "resolved": False,
            "error": str(exc),
        }
