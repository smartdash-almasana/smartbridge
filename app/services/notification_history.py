"""Notification History v1 — read-only view of outbound notification events.

Source of truth: existing audit trail (job_audit_events table).

Rationale for job_id-based filtering:
  - delivery events  → job_id = f"delivery_{tenant_id}"
  - orchestration     → job_id = f"orchestration_{tenant_id}"
The payload also carries an explicit ``tenant_id`` field which is used as a
second validation layer to guarantee tenant isolation.

No new tables. No side-effects. No mutation.
"""
from __future__ import annotations

from typing import Any

from app.services.audit_trail import list_recent_job_events


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_NOTIFICATION_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "notification_orchestration_started",
        "notification_orchestration_completed",
        "delivery_preview_generated",
        "delivery_sent",
        "delivery_failed",
    }
)

_STATUS_MAP: dict[str, str] = {
    "delivery_preview_generated": "preview",
    "delivery_sent": "sent",
    "delivery_failed": "failed",
}

# job_id prefixes that carry notification events for a given tenant.
_JOB_ID_PREFIXES = ("delivery_", "orchestration_")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_notification_history(
    tenant_id: str,
    limit: int = 20,
) -> dict[str, Any]:
    """Return a read-only, tenant-scoped history of notification events.

    Args:
        tenant_id: non-empty tenant identifier.
        limit:     max items to return (positive integer).

    Returns:
        dict with ``tenant_id``, ``count``, and ``items`` (list of events).

    Raises:
        ValueError: if ``tenant_id`` is empty or ``limit`` is not positive.
    """
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("tenant_id must be a non-empty string")
    if not isinstance(limit, int) or limit <= 0:
        raise ValueError("limit must be a positive integer")

    tenant_id_clean = tenant_id.strip()

    # Read a generous window from audit trail; filter down locally.
    raw_events = _safe_read_audit(limit * 10 + 100)

    items: list[dict[str, Any]] = []
    for event in raw_events:
        if len(items) >= limit:
            break

        event_type = str(event.get("event_type") or "").strip()
        if event_type not in _NOTIFICATION_EVENT_TYPES:
            continue

        if not _belongs_to_tenant(event, tenant_id_clean):
            continue

        items.append(_project_event(event, event_type))

    return {
        "tenant_id": tenant_id_clean,
        "count": len(items),
        "items": items,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_read_audit(window: int) -> list[dict[str, Any]]:
    """Read audit events without propagating errors."""
    try:
        return list_recent_job_events(limit=max(window, 1))
    except Exception:
        return []


def _belongs_to_tenant(event: dict[str, Any], tenant_id: str) -> bool:
    """Two-layer check: job_id prefix AND payload.tenant_id."""
    job_id = str(event.get("job_id") or "")

    # Primary: job_id must start with a known notification prefix for this tenant.
    job_id_match = any(
        job_id == f"{prefix}{tenant_id}"
        for prefix in _JOB_ID_PREFIXES
    )
    if not job_id_match:
        return False

    # Secondary: payload must carry the exact tenant_id (belt-and-suspenders).
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    payload_tenant = str(payload.get("tenant_id") or "").strip()
    return payload_tenant == tenant_id


def _project_event(event: dict[str, Any], event_type: str) -> dict[str, Any]:
    """Build a clean, minimal dict from a raw audit event — tolerates missing fields."""
    payload: dict[str, Any] = (
        event.get("payload") if isinstance(event.get("payload"), dict) else {}
    )

    status: str | None = _STATUS_MAP.get(event_type)

    return {
        "event_type": event_type,
        "channel": _safe_str(payload.get("channel")),
        "status": status,
        "job_id": _safe_str(event.get("job_id")),
        "recipient": _safe_str(payload.get("recipient")),
        "recipient_used": _safe_bool(payload.get("recipient_used")),
        "error": _safe_str(payload.get("error")),
        "created_at": _safe_str(event.get("created_at")),
    }


def _safe_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _safe_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    return None
