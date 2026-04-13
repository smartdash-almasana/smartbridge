from typing import Any

from app.services.digest.build_narrative import build_narrative


_ACTION_MAP: dict[str, str] = {
    "order_mismatch": "Revisar inconsistencia en la orden.",
    "order_missing_in_documents": "Solicitar documentación faltante.",
    "duplicate_order": "Verificar posible duplicado de orden.",
}


def build_action_output(digest: dict[str, Any]) -> dict[str, str]:
    narrative = build_narrative(digest)
    message = narrative["message"]

    summary = digest.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("digest['summary'] must be a dict.")

    total_active_signals = summary.get("total_active_signals")
    signals = summary.get("signals")

    if not isinstance(total_active_signals, int):
        raise ValueError("digest['summary']['total_active_signals'] must be an int.")
    if not isinstance(signals, list):
        raise ValueError("digest['summary']['signals'] must be a list.")

    if total_active_signals == 0:
        return {
            "message": message,
            "suggested_action": "No se requiere acción.",
        }

    if len(signals) == 0:
        raise ValueError("digest['summary']['signals'] must not be empty when total_active_signals > 0.")

    first = signals[0]
    if not isinstance(first, dict):
        raise ValueError("digest['summary']['signals'][0] must be a dict.")

    signal_code = first.get("signal_code")
    if not isinstance(signal_code, str):
        raise ValueError("signal_code must be a string.")

    return {
        "message": message,
        "suggested_action": _ACTION_MAP.get(signal_code, "Revisar señal detectada."),
    }
