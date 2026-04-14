"""Operational inbox read/query service (strictly side-effect free)."""
from __future__ import annotations

from typing import Any

from app.services.audit_trail import list_recent_job_events


def _tenant_scoped_events(events: list[dict[str, Any]], tenant_id: str) -> list[dict[str, Any]]:
    """Keep only events with explicit tenant scope matching tenant_id."""
    scoped: list[dict[str, Any]] = []
    for event in events:
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        event_tenant = payload.get("tenant_id")
        if event_tenant is None:
            continue
        if str(event_tenant).strip() != tenant_id:
            continue
        scoped.append(event)
    return scoped


def _pending_key(event: dict[str, Any]) -> str:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    source_finding_id = str(payload.get("source_finding_id", "")).strip()
    if source_finding_id:
        return source_finding_id
    return f"{event.get('job_id', 'unknown_job')}:{event.get('id', 0)}"


def _build_pending_actions(scoped_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Fold state in chronological order, then emit newest-first with deterministic tie-break.
    chronological = sorted(
        scoped_events,
        key=lambda e: (str(e.get("created_at", "")), int(e.get("id", 0))),
    )
    pending: dict[str, dict[str, Any]] = {}

    for event in chronological:
        event_type = str(event.get("event_type", "")).strip()
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        key = _pending_key(event)

        if event_type == "draft_created":
            pending[key] = {
                "source_finding_id": str(payload.get("source_finding_id", "")).strip() or None,
                "job_id": event.get("job_id"),
                "draft_type": payload.get("draft_type"),
                "entity_ref": payload.get("entity_ref"),
                "state": "pending_confirmation",
                "created_at": event.get("created_at"),
                "_event_id": int(event.get("id", 0)),
            }
        elif event_type in {"draft_confirmed", "draft_cancelled", "action_executed"}:
            pending.pop(key, None)

    ordered = sorted(
        pending.values(),
        key=lambda x: (
            str(x.get("created_at", "")),
            int(x.get("_event_id", 0)),
            str(x.get("source_finding_id") or ""),
        ),
        reverse=True,
    )
    for item in ordered:
        item.pop("_event_id", None)
    return ordered


def _build_recent_findings(scoped_events: list[dict[str, Any]], limit: int = 20) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for event in scoped_events:
        if str(event.get("event_type", "")).strip() != "findings_generated":
            continue
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        findings.append(
            {
                "job_id": event.get("job_id"),
                "event_type": "findings_generated",
                "findings_count": payload.get("findings_count"),
                "created_at": event.get("created_at"),
                "_event_id": int(event.get("id", 0)),
            }
        )

    findings.sort(
        key=lambda x: (str(x.get("created_at", "")), int(x.get("_event_id", 0))),
        reverse=True,
    )
    findings = findings[:limit]
    for item in findings:
        item.pop("_event_id", None)
    return findings


def _build_recent_messages(scoped_events: list[dict[str, Any]], limit: int = 20) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for event in scoped_events:
        event_type = str(event.get("event_type", "")).strip()
        if event_type == "findings_generated":
            continue
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        messages.append(
            {
                "job_id": event.get("job_id"),
                "event_type": event_type,
                "message": str(payload.get("message", f"{event_type} registrado")),
                "created_at": event.get("created_at"),
                "_event_id": int(event.get("id", 0)),
            }
        )

    messages.sort(
        key=lambda x: (str(x.get("created_at", "")), int(x.get("_event_id", 0))),
        reverse=True,
    )
    messages = messages[:limit]
    for item in messages:
        item.pop("_event_id", None)
    return messages


def get_operational_inbox(tenant_id: str) -> dict[str, Any]:
    """Return deterministic, read-only operational inbox snapshot."""
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("tenant_id must be a non-empty string")
    tenant_id_clean = tenant_id.strip()

    # Canonical read-only source for recent activity.
    events = list_recent_job_events(limit=300)
    scoped_events = _tenant_scoped_events(events, tenant_id_clean)

    # Safe isolation policy:
    # clarifications table has no reliable tenant scope => always excluded.
    pending_clarifications: list[dict[str, Any]] = []
    pending_actions = _build_pending_actions(scoped_events)
    recent_findings = _build_recent_findings(scoped_events)
    recent_messages = _build_recent_messages(scoped_events)
    pending_confirmation = sum(
        1 for item in pending_actions if str(item.get("state", "")).strip() == "pending_confirmation"
    )

    return {
        "tenant_id": tenant_id_clean,
        "counts": {
            "pending_clarifications": len(pending_clarifications),
            "pending_actions": len(pending_actions),
            "pending_confirmation": pending_confirmation,
            "recent_findings": len(recent_findings),
            "recent_messages": len(recent_messages),
        },
        "pending_clarifications": pending_clarifications,
        "pending_actions": pending_actions,
        "recent_findings": recent_findings,
        "recent_messages": recent_messages,
    }

