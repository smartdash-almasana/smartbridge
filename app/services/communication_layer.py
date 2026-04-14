"""Minimal communication layer for business-facing finding messages."""
from __future__ import annotations

from typing import Any


_ALLOWED_CHANNELS = {"whatsapp", "email", "ui"}


def _to_number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_difference(finding: dict[str, Any]) -> float | None:
    if "difference" in finding:
        return _to_number(finding.get("difference"))

    payload = finding.get("payload")
    if isinstance(payload, dict):
        return _to_number(payload.get("difference"))
    return None


def _extract_entity(finding: dict[str, Any]) -> str:
    entity = finding.get("entity_ref") or finding.get("entity_name")
    if isinstance(entity, str) and entity.strip():
        return entity.strip()

    metadata = finding.get("metadata")
    if isinstance(metadata, dict):
        order_id = metadata.get("order_id")
        if isinstance(order_id, str) and order_id.strip():
            return order_id.strip()
    return "entidad sin nombre"


def _extract_source_quantities(finding: dict[str, Any]) -> tuple[str, str]:
    source_a = finding.get("source_a")
    source_b = finding.get("source_b")

    qty_a: Any = None
    qty_b: Any = None
    if isinstance(source_a, dict):
        qty_a = source_a.get("quantity")
    if isinstance(source_b, dict):
        qty_b = source_b.get("quantity")

    a_text = str(qty_a) if qty_a is not None else "sin dato"
    b_text = str(qty_b) if qty_b is not None else "sin dato"
    return a_text, b_text


def classify_urgency(finding: dict[str, Any]) -> str:
    """Classify urgency based on finding severity or numeric difference."""
    severity = finding.get("severity")
    if isinstance(severity, str):
        normalized = severity.strip().lower()
        if normalized in {"high", "medium", "low"}:
            return normalized

    difference = _extract_difference(finding)
    if difference is None:
        return "low"

    abs_diff = abs(difference)
    if abs_diff >= 10:
        return "high"
    if abs_diff >= 5:
        return "medium"
    return "low"


def findings_to_messages(findings: list[dict[str, Any]], channel: str) -> list[dict[str, Any]]:
    """Transform findings into user-facing messages for a specific channel."""
    if channel not in _ALLOWED_CHANNELS:
        raise ValueError(f"Unsupported channel: {channel}")

    if not findings:
        return []

    messages: list[dict[str, Any]] = []
    for index, finding in enumerate(findings, start=1):
        finding_id = finding.get("finding_id")
        if not isinstance(finding_id, str) or not finding_id.strip():
            finding_id = f"finding_{index}"

        urgency = classify_urgency(finding)
        entity = _extract_entity(finding)
        difference = _extract_difference(finding)
        a_qty, b_qty = _extract_source_quantities(finding)

        diff_text = str(int(difference)) if isinstance(difference, float) and difference.is_integer() else str(difference if difference is not None else "sin dato")
        action_required = urgency in {"high", "medium"}
        action_description = (
            "Revisar y confirmar la diferencia con el equipo."
            if action_required
            else "Monitorear en el siguiente corte."
        )

        if channel == "whatsapp":
            message_text = (
                f"Detectamos una diferencia de {diff_text} para {entity}. "
                f"En origen A figura {a_qty} y en origen B figura {b_qty}. "
                f"{action_description}"
            )
        elif channel == "email":
            message_text = (
                f"Se detecto una diferencia de {diff_text} para {entity}. "
                f"Comparacion de origenes: A={a_qty} y B={b_qty}. "
                f"Accion sugerida: {action_description}"
            )
        else:
            message_text = (
                f"Diferencia detectada para {entity}: {diff_text}. "
                f"Origen A={a_qty}, origen B={b_qty}. "
                f"Accion: {action_description}"
            )

        messages.append(
            {
                "finding_id": finding_id,
                "channel": channel,
                "message_text": message_text,
                "action_required": action_required,
                "action_description": action_description,
                "urgency": urgency,
            }
        )

    return messages

