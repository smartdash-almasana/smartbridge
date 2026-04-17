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


def evaluate_replacement_lag(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sale_price = _first_number(row, "sale_price", "price")
    replacement_cost = _first_number(row, "replacement_cost", "cost", "buy_cost")
    if sale_price is None or replacement_cost is None:
        return None
    threshold_value = replacement_cost * 1.25
    if sale_price >= threshold_value:
        return None

    gap = threshold_value - sale_price
    severity = "high" if threshold_value > 0 and (gap / threshold_value) >= 0.15 else "medium"
    metadata: Dict[str, Any] = {
        "sale_price": sale_price,
        "replacement_cost": replacement_cost,
        "threshold_value": threshold_value,
        "recommended_action": "Actualizar precio de venta por debajo del costo de reposicion.",
    }

    quantity = _first_number(row, "quantity", "stock", "on_hand", "current_quantity")
    if quantity is not None:
        metadata["exposure_value"] = round(gap * quantity, 4)

    confidence_score = _as_float(row.get("confidence_score"))
    if confidence_score is not None:
        metadata["confidence_score"] = max(0.0, min(1.0, confidence_score))

    return {
        "type": "replacement_lag",
        "severity": severity,
        "description": f"Precio de venta {sale_price} por debajo del costo de reposicion {threshold_value}.",
        "metadata": metadata,
    }
