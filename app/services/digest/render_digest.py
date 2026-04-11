"""
services/digest/render_digest.py
--------------------------------
Renderiza el digest estructurado en texto corto y accionable para el dueño.
"""

from typing import Any


def render_digest_text(digest: dict[str, Any]) -> str:
    if not isinstance(digest, dict):
        raise ValueError("digest must be a dict.")

    summary = digest.get("summary")
    focus = digest.get("focus")
    top_signals = digest.get("top_signals")

    if not isinstance(summary, dict):
        raise ValueError("digest['summary'] must be a dict.")

    if focus is None:
        return "📊 Estado de hoy\nSin problemas detectados"

    if not isinstance(top_signals, list):
        raise ValueError("digest['top_signals'] must be a list.")

    total = summary.get("total")
    high = summary.get("high")
    medium = summary.get("medium")
    low = summary.get("low")

    if not all(isinstance(v, int) for v in (total, high, medium, low)):
        raise ValueError("summary values must be integers.")

    main_issue = focus.get("main_issue")
    if not isinstance(main_issue, str):
        raise ValueError("focus['main_issue'] must be a string.")

    lines: list[str] = []

    # Línea 1
    lines.append("📊 Estado de hoy")

    # Línea 2
    lines.append(f"Total: {total} | Alta: {high} | Media: {medium} | Baja: {low}")

    # Línea 3
    lines.append(f"⚠️ Principal: {main_issue}")

    # Línea 4+
    for signal in top_signals[:3]:
        if not isinstance(signal, dict):
            continue

        signal_code = signal.get("signal_code")
        entity_ref = signal.get("entity_ref")

        if isinstance(signal_code, str) and isinstance(entity_ref, str):
            lines.append(f"- {signal_code} → {entity_ref}")

    return "\n".join(lines)

