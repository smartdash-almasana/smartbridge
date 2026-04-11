"""
diff.py
-------
Pure diff logic: compares matched (event, document) pairs and reports
field-level discrepancies.

Inspected fields: status, total_amount.
No fallbacks — if a field is absent after normalization, that is an error.
Returns a sorted list of mismatch records for deterministic output.
"""

import logging
from typing import Any

from .matcher import MatchedPair

logger = logging.getLogger(__name__)

# Fields to compare. Order matters for deterministic reason list output.
COMPARED_FIELDS: tuple[str, ...] = ("status", "total_amount")


def _diff_pair(
    event: dict[str, Any],
    document: dict[str, Any],
) -> list[str]:
    """
    Compare a single matched pair and return a list of human-readable
    mismatch reason strings.

    Returns an empty list when event and document agree on all fields.
    """
    reasons: list[str] = []
    order_id = event["order_id"]

    for field in COMPARED_FIELDS:
        event_val = event.get(field)
        doc_val = document.get(field)

        if event_val is None:
            raise ValueError(
                f"Normalized event for order_id '{order_id}' is missing field '{field}'."
            )
        if doc_val is None:
            raise ValueError(
                f"Normalized document for order_id '{order_id}' is missing field '{field}'."
            )

        if event_val != doc_val:
            reasons.append(
                f"{field} mismatch: event={event_val!r}, document={doc_val!r}"
            )

    return reasons


def diff_matched_orders(
    matched: list[MatchedPair],
) -> list[dict[str, Any]]:
    """
    Find field-level mismatches in all matched (event, document) pairs.

    Returns a sorted list (by order_id) of mismatch records. Each record:
        {
            "order_id": str,
            "event":    dict,
            "document": dict,
            "reasons":  list[str],  # at least one entry guaranteed
        }

    Pairs with no differences are excluded from the returned list.
    """
    mismatches: list[dict[str, Any]] = []

    for event, document in matched:
        reasons = _diff_pair(event, document)
        if reasons:
            mismatches.append(
                {
                    "order_id": event["order_id"],
                    "event": event,
                    "document": document,
                    "reasons": reasons,
                }
            )

    mismatches.sort(key=lambda m: m["order_id"])

    logger.debug("Diff complete: %d mismatch(es) found.", len(mismatches))
    return mismatches
