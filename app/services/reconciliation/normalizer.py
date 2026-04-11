"""
normalizer.py
-------------
Pure normalization functions for raw order records.

Rules:
- order_id: convert any numeric representation (including scientific notation)
  to a plain integer string. Raises ValueError for unparseable values.
- total_amount: parse to float. Raises ValueError for unparseable values.
- status: map via STATUS_NORMALIZATION_MAP. Raises ValueError for unknown statuses.
- All other fields are preserved unchanged (pass-through).

No mutations of the original dict — returns a new dict every time.
"""

import logging
from typing import Any

from .constants import STATUS_NORMALIZATION_MAP, VALID_STATUSES

logger = logging.getLogger(__name__)

# Required fields that MUST be present in every raw order record.
REQUIRED_FIELDS: frozenset[str] = frozenset({"order_id", "total_amount", "status"})


def _normalize_order_id(raw: Any) -> str:
    """
    Convert a raw order_id value to a plain integer string.

    Accepts: int, float, str (including scientific notation like "1.23E+02").
    Raises ValueError if the value cannot be converted.
    """
    if raw is None:
        raise ValueError("order_id is required and must not be None.")
    try:
        # int(float(...)) safely handles "1.23E+02" → 123
        return str(int(float(str(raw))))
    except (ValueError, TypeError) as exc:
        raise ValueError(
            f"order_id '{raw}' cannot be converted to an integer string."
        ) from exc


def _normalize_total_amount(raw: Any) -> float:
    """
    Convert a raw total_amount to float.
    Raises ValueError if the value cannot be parsed.
    """
    if raw is None:
        raise ValueError("total_amount is required and must not be None.")
    try:
        return float(raw)
    except (ValueError, TypeError) as exc:
        raise ValueError(
            f"total_amount '{raw}' cannot be converted to float."
        ) from exc


def _normalize_status(raw: Any) -> str:
    """
    Normalize a raw status string to one of VALID_STATUSES via
    STATUS_NORMALIZATION_MAP.
    Raises ValueError for unknown or unmappable status values.
    """
    if raw is None:
        raise ValueError("status is required and must not be None.")
    key = str(raw).lower().strip()
    normalized = STATUS_NORMALIZATION_MAP.get(key)
    if normalized is None:
        raise ValueError(
            f"status '{raw}' is not recognized. "
            f"Valid raw values: {sorted(STATUS_NORMALIZATION_MAP.keys())}"
        )
    assert normalized in VALID_STATUSES, (
        f"Internal mapping error: '{normalized}' is not a valid status."
    )
    return normalized


def _validate_required_fields(record: dict[str, Any]) -> None:
    """Raise ValueError listing any missing required fields."""
    missing = REQUIRED_FIELDS - record.keys()
    if missing:
        raise ValueError(
            f"Order record is missing required field(s): {sorted(missing)}. "
            f"Record: {record}"
        )


def normalize_order(order: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize a single raw order record.

    Returns a new dict with normalized values. The original dict is never
    mutated. All fields not in REQUIRED_FIELDS are forwarded unchanged.

    Raises ValueError for any invalid field.
    """
    _validate_required_fields(order)

    normalized_id = _normalize_order_id(order["order_id"])
    normalized_amount = _normalize_total_amount(order["total_amount"])
    normalized_status = _normalize_status(order["status"])

    # Build a new dict — never mutate the caller's input.
    result: dict[str, Any] = {
        k: v for k, v in order.items()
        if k not in REQUIRED_FIELDS
    }
    result["order_id"] = normalized_id
    result["total_amount"] = normalized_amount
    result["status"] = normalized_status

    return result


def normalize_orders(orders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Normalize a list of raw order records.
    Raises ValueError (with index context) on the first invalid record.
    """
    normalized: list[dict[str, Any]] = []
    for idx, order in enumerate(orders):
        try:
            normalized.append(normalize_order(order))
        except ValueError as exc:
            raise ValueError(f"Normalization error at record index {idx}: {exc}") from exc
    return normalized
