"""Operational inbox read/query service (strictly side-effect free)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.audit_trail import list_recent_job_events
from app.services.communication_layer import build_human_messages


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
        payload_findings = payload.get("findings")

        if isinstance(payload_findings, list) and payload_findings:
            try:
                human_messages = build_human_messages(payload_findings, "ui")
            except Exception:
                human_messages = []

            if human_messages:
                for message in human_messages:
                    findings.append(
                        {
                            "job_id": event.get("job_id"),
                            "event_type": "findings_generated",
                            "findings_count": payload.get("findings_count"),
                            "created_at": event.get("created_at"),
                            "finding_id": message.get("finding_id"),
                            "entity_ref": message.get("entity_ref"),
                            "urgency": message.get("urgency"),
                            "action_required": message.get("action_required"),
                            "summary": message.get("message_text"),
                            "_event_id": int(event.get("id", 0)),
                        }
                    )
                continue

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


def _urgency_rank(urgency: str | None) -> int:
    normalized = str(urgency or "").strip().lower()
    if normalized in {"alta", "high"}:
        return 3
    if normalized in {"media", "medium"}:
        return 2
    return 1


def _normalize_urgency(urgency: str | None) -> str:
    normalized = str(urgency or "").strip().lower()
    if normalized in {"alta", "high"}:
        return "alta"
    if normalized in {"media", "medium"}:
        return "media"
    return "baja"


def _created_at_ts(created_at: Any) -> float:
    if not isinstance(created_at, str) or not created_at.strip():
        return 0.0
    normalized = created_at.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).timestamp()
    except Exception:
        return 0.0


def _priority_title(kind: str, urgency: str, entity_ref: Any) -> str:
    entity_text = str(entity_ref).strip() if entity_ref is not None else ""
    if kind == "pending_action":
        return f"Accion pendiente: {entity_text}" if entity_text else "Accion pendiente de revision"
    if kind == "finding":
        if urgency == "alta":
            return "Diferencia alta detectada"
        if urgency == "media":
            return "Diferencia media detectada"
        return "Diferencia detectada"
    return "Actualizacion reciente"


def _priority_summary(kind: str, item: dict[str, Any], urgency: str) -> str:
    if kind == "pending_action":
        entity_ref = item.get("entity_ref")
        draft_type = item.get("draft_type")
        entity_text = str(entity_ref).strip() if entity_ref is not None else "entidad"
        draft_text = str(draft_type).strip() if draft_type is not None else "accion"
        return f"Revisar {draft_text} para {entity_text} y confirmar decision."

    if kind == "finding":
        summary = item.get("summary")
        if isinstance(summary, str) and summary.strip():
            return summary.strip()
        findings_count = item.get("findings_count")
        if findings_count is not None:
            return f"Se detectaron {findings_count} diferencias. Prioridad {urgency}."
        return f"Se detecto una diferencia con prioridad {urgency}."

    message = item.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()
    event_type = str(item.get("event_type", "evento")).strip() or "evento"
    return f"Evento registrado: {event_type}."


def _build_priority_items(
    pending_actions: list[dict[str, Any]],
    recent_findings: list[dict[str, Any]],
    recent_messages: list[dict[str, Any]],
    limit: int = 5,
) -> list[dict[str, Any]]:
    pending_finding_refs = {
        str(item.get("source_finding_id")).strip()
        for item in pending_actions
        if item.get("source_finding_id") is not None and str(item.get("source_finding_id")).strip()
    }
    pending_action_job_refs = {
        str(item.get("job_id")).strip()
        for item in pending_actions
        if item.get("job_id") is not None and str(item.get("job_id")).strip()
    }
    priority_candidates: list[dict[str, Any]] = []

    for item in pending_actions:
        urgency = "alta" if str(item.get("state", "")).strip() == "pending_confirmation" else "media"
        priority_candidates.append(
            {
                "kind": "pending_action",
                "priority_score": 100,
                "urgency": urgency,
                "title": _priority_title("pending_action", urgency, item.get("entity_ref")),
                "summary": _priority_summary("pending_action", item, urgency),
                "action_required": True,
                "entity_ref": item.get("entity_ref"),
                "job_id": item.get("job_id"),
                "created_at": item.get("created_at"),
                "_stable_key": "pending_action|"
                + str(item.get("job_id", ""))
                + "|"
                + str(item.get("source_finding_id", ""))
                + "|"
                + str(item.get("entity_ref", "")),
            }
        )

    for item in recent_findings:
        finding_id = item.get("finding_id")
        if isinstance(finding_id, str) and finding_id.strip() in pending_finding_refs:
            continue

        urgency = _normalize_urgency(item.get("urgency"))
        priority_score = 80 if urgency == "alta" else 60 if urgency == "media" else 40
        action_required = bool(item.get("action_required", urgency != "baja"))
        priority_candidates.append(
            {
                "kind": "finding",
                "priority_score": priority_score,
                "urgency": urgency,
                "title": _priority_title("finding", urgency, item.get("entity_ref")),
                "summary": _priority_summary("finding", item, urgency),
                "action_required": action_required,
                "entity_ref": item.get("entity_ref"),
                "job_id": item.get("job_id"),
                "created_at": item.get("created_at"),
                "_stable_key": "finding|"
                + str(item.get("job_id", ""))
                + "|"
                + str(item.get("finding_id", ""))
                + "|"
                + str(item.get("entity_ref", "")),
            }
        )

    for item in recent_messages:
        event_type = str(item.get("event_type", "")).strip()
        job_ref = str(item.get("job_id", "")).strip()
        # Cross-kind dedupe: once represented as pending action, same draft-created
        # operational work should not reappear as technical message.
        if event_type == "draft_created" and job_ref in pending_action_job_refs:
            continue

        urgency = _normalize_urgency(item.get("urgency"))
        priority_candidates.append(
            {
                "kind": "message",
                "priority_score": 20,
                "urgency": urgency,
                "title": _priority_title("message", urgency, item.get("entity_ref")),
                "summary": _priority_summary("message", item, urgency),
                "action_required": False,
                "entity_ref": item.get("entity_ref"),
                "job_id": item.get("job_id"),
                "created_at": item.get("created_at"),
                "_stable_key": "message|"
                + str(item.get("job_id", ""))
                + "|"
                + str(item.get("event_type", ""))
                + "|"
                + str(item.get("created_at", "")),
            }
        )

    priority_candidates.sort(
        key=lambda x: (
            -int(x.get("priority_score", 0)),
            -_urgency_rank(str(x.get("urgency", ""))),
            -_created_at_ts(x.get("created_at")),
            str(x.get("_stable_key", "")),
        )
    )

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in priority_candidates:
        dedupe_key = (
            str(item.get("kind", ""))
            + "|"
            + str(item.get("job_id", ""))
            + "|"
            + str(item.get("entity_ref", ""))
            + "|"
            + str(item.get("title", ""))
            + "|"
            + str(item.get("summary", ""))
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        item.pop("_stable_key", None)
        deduped.append(item)
        if len(deduped) >= limit:
            break
    return deduped


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
    priority_items = _build_priority_items(pending_actions, recent_findings, recent_messages)
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
            "priority_items": len(priority_items),
        },
        "pending_clarifications": pending_clarifications,
        "pending_actions": pending_actions,
        "recent_findings": recent_findings,
        "recent_messages": recent_messages,
        "priority_items": priority_items,
    }
