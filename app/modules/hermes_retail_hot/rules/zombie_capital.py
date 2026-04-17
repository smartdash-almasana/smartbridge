from __future__ import annotations

from typing import Any, Dict, Optional


def _as_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_number(row: Dict[str, Any], *keys: str) -> Optional[float]:
    for key in keys:
        value = _as_float(row.get(key))
        if value is not None:
            return value
    return None


def evaluate_zombie_capital(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    stock = _as_float(row.get("stock"))
    movement = _as_float(row.get("recent_movement"))
    if stock is None or movement is None:
        return None
    if stock <= 0 or movement > 0:
        return None

    exposure_value = _first_number(row, "inventory_value")
    if exposure_value is None:
        unit_cost = _first_number(row, "replacement_cost", "cost", "buy_cost")
        if unit_cost is None:
            return None
        exposure_value = stock * unit_cost

    severity = "high" if exposure_value >= 10000 else "medium"
    metadata: Dict[str, Any] = {
        "stock": stock,
        "recent_movement": movement,
        "exposure_value": round(exposure_value, 4),
        "recommended_action": "Reducir stock inmovil y acelerar rotacion comercial.",
    }
    confidence_score = _as_float(row.get("confidence_score"))
    if confidence_score is not None:
        metadata["confidence_score"] = max(0.0, min(1.0, confidence_score))

    return {
        "type": "zombie_capital",
        "severity": severity,
        "description": f"Stock inmovil detectado con exposicion {metadata['exposure_value']}.",
        "metadata": metadata,
    }
