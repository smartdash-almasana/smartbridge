"""Notification Orchestrator v1 — decides what to notify, on which channel, in what order."""
from __future__ import annotations

from typing import Any

from app.services import audit_trail
from app.services.delivery_adapter import deliver_messages
from app.services.inbox_service import get_operational_inbox


# ---------------------------------------------------------------------------
# Channel policy
# ---------------------------------------------------------------------------
_CHANNEL_MAP: dict[str, str | None] = {
    "alta": "telegram",
    "media": "email",
    "baja": None,  # skip in v1
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def orchestrate_notifications(
    tenant_id: str,
    dry_run: bool = True,
    limit: int = 3,
) -> dict[str, Any]:
    """Decide which priority_items to notify, on which channel, and invoke deliver_messages.

    Rules:
    - urgency="alta"  -> telegram
    - urgency="media" -> email
    - urgency="baja"  -> skipped (recorded in result)
    - Items with no resolvable recipient are passed as-is; the adapter handles it.
    - Items of the same channel are grouped into a single deliver_messages call.
    - No mutations to inbox, findings, actions, or confirmations.
    """
    # --- Validation ---
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("tenant_id must be a non-empty string")
    if not isinstance(limit, int) or limit <= 0:
        raise ValueError("limit must be a positive integer")

    tenant_id_clean = tenant_id.strip()

    # --- Read inbox ---
    inbox = get_operational_inbox(tenant_id_clean)
    priority_items: list[dict[str, Any]] = inbox.get("priority_items") or []

    # --- Audit: started ---
    _audit_orchestration_event(
        tenant_id_clean,
        "notification_orchestration_started",
        {"dry_run": dry_run, "limit": limit, "total_priority_items": len(priority_items)},
    )

    # --- Select up to `limit` items and route by urgency ---
    selected = priority_items[:limit]
    grouped: dict[str, list[dict[str, Any]]] = {}  # channel -> outbound messages
    skipped: list[dict[str, Any]] = []

    for item in selected:
        urgency = str(item.get("urgency") or "baja").strip().lower()
        channel = _CHANNEL_MAP.get(urgency)

        if channel is None:
            skipped.append({"reason": f"urgency='{urgency}' skipped in v1", "item": item})
            continue

        outbound = _build_outbound_message(item)
        grouped.setdefault(channel, []).append(outbound)

    # --- Deliver, one call per channel ---
    deliveries: list[dict[str, Any]] = []
    for channel, messages in grouped.items():
        delivery_result = deliver_messages(
            tenant_id=tenant_id_clean,
            channel=channel,
            messages=messages,
            dry_run=dry_run,
        )
        deliveries.append({"channel": channel, "delivery_result": delivery_result})

    selected_count = sum(len(msgs) for msgs in grouped.values())

    result: dict[str, Any] = {
        "tenant_id": tenant_id_clean,
        "dry_run": dry_run,
        "selected_count": selected_count,
        "skipped_count": len(skipped),
        "deliveries": deliveries,
        "skipped": skipped,
    }

    # --- Audit: completed ---
    _audit_orchestration_event(
        tenant_id_clean,
        "notification_orchestration_completed",
        {
            "dry_run": dry_run,
            "selected_count": selected_count,
            "skipped_count": len(skipped),
            "channels_used": list(grouped.keys()),
        },
    )

    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_outbound_message(item: dict[str, Any]) -> dict[str, Any]:
    """Build a minimal outbound message suitable for deliver_messages(...)."""
    summary = item.get("summary") or item.get("title") or ""
    recipient = _resolve_recipient(item)
    return {"message_text": str(summary).strip(), "recipient": recipient}


def _resolve_recipient(item: dict[str, Any]) -> str | None:
    """Resolve recipient explicitly — never invent one."""
    raw = item.get("recipient")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    # Fallback: look for known safe explicit field in entity_ref (only if string)
    entity_ref = item.get("entity_ref")
    if isinstance(entity_ref, str) and entity_ref.strip():
        # entity_ref is an identifier, not a contact — do NOT use as recipient.
        pass
    return None


def _audit_orchestration_event(
    tenant_id: str,
    event_type: str,
    payload_extra: dict[str, Any],
) -> None:
    try:
        audit_trail.log_job_event(
            job_id=f"orchestration_{tenant_id}",
            event_type=event_type,
            payload={"tenant_id": tenant_id, **payload_extra},
        )
    except Exception:
        # Audit must not break orchestration.
        pass
