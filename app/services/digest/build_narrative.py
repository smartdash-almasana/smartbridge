from typing import Any


def build_narrative(digest: dict[str, Any]) -> dict[str, str]:
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
        return {"message": "Hoy no hay alertas activas."}

    if len(signals) == 0:
        raise ValueError("digest['summary']['signals'] must not be empty when total_active_signals > 0.")

    first = signals[0]
    if not isinstance(first, dict):
        raise ValueError("digest['summary']['signals'][0] must be a dict.")

    signal_code = first.get("signal_code")
    entity_ref = first.get("entity_ref")
    if not isinstance(signal_code, str):
        raise ValueError("signal_code must be a string.")
    if not isinstance(entity_ref, str):
        raise ValueError("entity_ref must be a string.")

    if total_active_signals == 1:
        return {"message": f"Tenés 1 alerta activa: {signal_code} en {entity_ref}."}

    return {
        "message": (
            f"Tenés {total_active_signals} alertas activas. "
            f"La más reciente es {signal_code} en {entity_ref}."
        )
    }
