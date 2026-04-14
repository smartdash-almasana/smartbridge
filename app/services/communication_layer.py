"""Minimal communication layer for business-facing finding messages."""
from __future__ import annotations

from typing import Any


_ALLOWED_CHANNELS = {"whatsapp", "email", "ui"}
_SPANISH_URGENCIES = {"alta", "media", "baja"}
_LEGACY_URGENCY_MAP = {"alta": "high", "media": "medium", "baja": "low"}


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
        payload_difference = _to_number(payload.get("difference"))
        if payload_difference is not None:
            return payload_difference

    source_a_number, source_b_number = _extract_numeric_source_values(finding)
    if source_a_number is not None and source_b_number is not None:
        return source_a_number - source_b_number
    return None


def _extract_entity_ref(finding: dict[str, Any]) -> str | None:
    entity = finding.get("entity_ref")
    if isinstance(entity, str) and entity.strip():
        return entity.strip()

    entity_name = finding.get("entity_name")
    if isinstance(entity_name, str) and entity_name.strip():
        return entity_name.strip()

    metadata = finding.get("metadata")
    if isinstance(metadata, dict):
        order_id = metadata.get("order_id")
        if isinstance(order_id, str) and order_id.strip():
            return order_id.strip()
    return None


def _extract_entity_label(finding: dict[str, Any]) -> str:
    entity_ref = _extract_entity_ref(finding)
    return entity_ref if entity_ref is not None else "la entidad"


def _extract_source_quantities(finding: dict[str, Any]) -> tuple[str, str]:
    source_a_value, source_b_value = _extract_raw_source_values(finding)
    a_text = str(source_a_value) if source_a_value is not None else "sin dato"
    b_text = str(source_b_value) if source_b_value is not None else "sin dato"
    return a_text, b_text


def _extract_raw_source_values(finding: dict[str, Any]) -> tuple[Any, Any]:
    direct_a = finding.get("source_a_value")
    direct_b = finding.get("source_b_value")
    if direct_a is not None or direct_b is not None:
        return direct_a, direct_b

    source_a = finding.get("source_a")
    source_b = finding.get("source_b")

    value_a: Any = None
    value_b: Any = None
    if isinstance(source_a, dict):
        value_a = source_a.get("quantity")
        if value_a is None:
            value_a = source_a.get("value")
    if isinstance(source_b, dict):
        value_b = source_b.get("quantity")
        if value_b is None:
            value_b = source_b.get("value")
    return value_a, value_b


def _extract_numeric_source_values(finding: dict[str, Any]) -> tuple[float | None, float | None]:
    raw_a, raw_b = _extract_raw_source_values(finding)
    return _to_number(raw_a), _to_number(raw_b)


def _format_difference(value: float | None) -> str:
    if value is None:
        return "sin dato"
    if value.is_integer():
        return str(int(value))
    return str(value)


def _classify_urgency_es(finding: dict[str, Any]) -> str:
    """Classify urgency in the new Spanish contract."""
    severity = finding.get("severity")
    if isinstance(severity, str):
        normalized = severity.strip().lower()
        if normalized in _SPANISH_URGENCIES:
            return normalized
        if normalized == "high":
            return "alta"
        if normalized == "medium":
            return "media"
        if normalized == "low":
            return "baja"

    difference = _extract_difference(finding)
    if difference is None:
        return "media"

    abs_diff = abs(difference)
    if abs_diff >= 10:
        return "alta"
    if abs_diff >= 5:
        return "media"
    return "baja"


def _classify_urgency_legacy(finding: dict[str, Any]) -> str:
    return _LEGACY_URGENCY_MAP[_classify_urgency_es(finding)]


def _validate_channel(channel: str) -> str:
    if not isinstance(channel, str) or not channel.strip():
        raise ValueError("channel must be a non-empty string")
    normalized = channel.strip().lower()
    if normalized not in _ALLOWED_CHANNELS:
        raise ValueError(f"Unsupported channel: {channel}")
    return normalized


def _build_action_description(urgency: str) -> str | None:
    if urgency == "alta":
        return "Revisar la diferencia ahora y confirmar el dato correcto."
    if urgency == "media":
        return "Revisar la diferencia y confirmar el dato correcto."
    return None


def _extract_suggested_action(finding: dict[str, Any]) -> str | None:
    suggested_action = finding.get("suggested_action")
    if isinstance(suggested_action, str) and suggested_action.strip():
        return suggested_action.strip()

    payload = finding.get("payload")
    if isinstance(payload, dict):
        payload_action = payload.get("suggested_action")
        if isinstance(payload_action, str) and payload_action.strip():
            return payload_action.strip()
    return None


def _has_quantified_difference(finding: dict[str, Any]) -> bool:
    return _extract_difference(finding) is not None


def _build_message_text(
    *,
    finding: dict[str, Any],
    channel: str,
    urgency: str,
) -> str:
    entity = _extract_entity_label(finding)
    difference = _format_difference(_extract_difference(finding))
    source_a, source_b = _extract_source_quantities(finding)

    if channel == "whatsapp":
        return (
            f"Detectamos una diferencia en {entity}. "
            f"La diferencia es de {difference}. "
            f"Comparacion de fuentes: A={source_a} y B={source_b}."
        )
    if channel == "email":
        action_text = _build_action_description(urgency)
        if action_text is None:
            action_text = "Sin accion inmediata."
        return (
            f"Se detecto una diferencia en {entity}. "
            f"La diferencia es de {difference}. "
            f"Comparacion de fuentes: A={source_a} y B={source_b}. {action_text}"
        )
    action_text = _build_action_description(urgency)
    if action_text is None:
        action_text = "Sin accion inmediata."
    return (
        f"Diferencia en {entity}. "
        f"Diferencia: {difference}. "
        f"Comparacion: origen A={source_a} y origen B={source_b}. {action_text}"
    )


def _build_legacy_message_text(
    *,
    finding: dict[str, Any],
    channel: str,
    urgency: str,
) -> str:
    entity = _extract_entity_label(finding)
    difference = _format_difference(_extract_difference(finding))
    source_a, source_b = _extract_source_quantities(finding)
    action_description = (
        "Revisar y confirmar la diferencia con el equipo."
        if urgency in {"high", "medium"}
        else "Monitorear en el siguiente corte."
    )

    if channel == "whatsapp":
        return (
            f"Detectamos una diferencia de {difference} para {entity}. "
            f"En origen A figura {source_a} y en origen B figura {source_b}. "
            f"{action_description}"
        )
    if channel == "email":
        return (
            f"Se detecto una diferencia de {difference} para {entity}. "
            f"Comparacion de origenes: A={source_a} y B={source_b}. "
            f"Accion sugerida: {action_description}"
        )
    return (
        f"Diferencia detectada para {entity}: {difference}. "
        f"Origen A={source_a}, origen B={source_b}. "
        f"Accion: {action_description}"
    )


def _build_human_message_record(
    finding: dict[str, Any],
    channel: str,
    *,
    legacy_urgency: bool,
) -> dict[str, Any]:
    finding_id = finding.get("finding_id")
    if not isinstance(finding_id, str) or not finding_id.strip():
        finding_id = None

    entity_ref = _extract_entity_ref(finding)
    urgency = _classify_urgency_legacy(finding) if legacy_urgency else _classify_urgency_es(finding)
    suggested_action = _extract_suggested_action(finding)
    action_required = _has_quantified_difference(finding) or suggested_action is not None
    action_description = suggested_action
    if action_description is None and action_required:
        action_description = (
            "Revisar la diferencia ahora y confirmar el dato correcto."
            if urgency in {"alta", "high"}
            else "Revisar la diferencia y confirmar el dato correcto."
            if urgency in {"media", "medium"}
            else "Revisar la diferencia informada y confirmar el dato."
        )

    message_text = _build_message_text(
        finding=finding,
        channel=channel,
        urgency=urgency if not legacy_urgency else _classify_urgency_es(finding),
    )

    return {
        "finding_id": finding_id,
        "entity_ref": entity_ref,
        "message_text": message_text,
        "urgency": urgency,
        "action_required": action_required,
        "action_description": action_description,
        "channel": channel,
    }


def build_human_messages(findings: list[dict[str, Any]], channel: str = "ui") -> list[dict[str, Any]]:
    """Transform findings into human-facing messages using the new Spanish contract."""
    channel_name = _validate_channel(channel)
    if not findings:
        return []

    return [
        _build_human_message_record(finding, channel_name, legacy_urgency=False)
        for finding in findings
    ]


def classify_urgency(finding: dict[str, Any]) -> str:
    """Backward-compatible urgency classifier used by older tests."""
    return _classify_urgency_legacy(finding)


def findings_to_messages(findings: list[dict[str, Any]], channel: str) -> list[dict[str, Any]]:
    """Backward-compatible wrapper that preserves the previous contract."""
    channel_name = _validate_channel(channel)
    if not findings:
        return []

    messages: list[dict[str, Any]] = []
    for finding in findings:
        message = _build_human_message_record(finding, channel_name, legacy_urgency=True)
        message["message_text"] = _build_legacy_message_text(
            finding=finding,
            channel=channel_name,
            urgency=_classify_urgency_legacy(finding),
        )
        message["urgency"] = _classify_urgency_legacy(finding)
        messages.append(message)
    return messages
