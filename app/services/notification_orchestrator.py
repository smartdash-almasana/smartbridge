"""Notification Orchestrator v1 — decides what to notify, on which channel, in what order."""
from __future__ import annotations

from typing import Any

from app.services import audit_trail
from app.services.delivery_adapter import deliver_messages
from app.services.inbox_service import get_operational_inbox
from app.services.notification_policy import apply_notification_policy
from app.services.recipient_resolution import resolve_recipient


# Channel policy is now owned by notification_policy.py.


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

    # --- Apply notification policy (anti-noise, channel caps, dedup) ---
    policy_result = apply_notification_policy(priority_items, limit=limit)
    skipped: list[dict[str, Any]] = policy_result["skipped"]

    # Build outbound messages grouped by channel.
    grouped: dict[str, list[dict[str, Any]]] = {}
    for channel, items in policy_result["selected_by_channel"].items():
        if not items:
            continue
        outbound_list = [
            _build_outbound_message(item, tenant_id_clean, channel)
            for item in items
        ]
        grouped[channel] = outbound_list

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

def _build_outbound_message(
    item: dict[str, Any],
    tenant_id: str,
    channel: str,
) -> dict[str, Any]:
    """Build a minimal outbound message suitable for deliver_messages(...).

    Recipient is resolved via recipient_resolution (canonical, never invented).
    If the item already carries an explicit recipient field it takes priority.
    """
    summary = item.get("summary") or item.get("title") or ""
    # Item-level explicit recipient wins; otherwise delegate to canonical resolver.
    raw = item.get("recipient")
    if isinstance(raw, str) and raw.strip():
        recipient: str | None = raw.strip()
    else:
        recipient = resolve_recipient(tenant_id, channel)
    return {"message_text": str(summary).strip(), "recipient": recipient}


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
