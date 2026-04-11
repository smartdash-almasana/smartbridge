"""
matcher.py
----------
Pure matching logic: aligns normalized events and documents by order_id.

Returns three disjoint, sorted lists:
- matched     : pairs (event, document) where order_id appears in both.
- missing_in_events    : documents with no matching event.
- missing_in_documents : events with no matching document.

Sorting guarantees deterministic output regardless of input list order.
No mutations — returns new structures every time.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# TypeAlias for a matched pair
MatchedPair = tuple[dict[str, Any], dict[str, Any]]


def _index_by_order_id(
    records: list[dict[str, Any]],
    label: str,
) -> dict[str, dict[str, Any]]:
    """
    Build an order_id → record dict. Detects and raises on duplicate order_ids.
    """
    index: dict[str, dict[str, Any]] = {}
    for record in records:
        oid = record.get("order_id")
        if oid is None:
            raise ValueError(
                f"A normalized {label} record is missing 'order_id': {record}"
            )
        if oid in index:
            raise ValueError(
                f"Duplicate order_id '{oid}' detected in {label} list."
            )
        index[oid] = record
    return index


def match_orders(
    events: list[dict[str, Any]],
    documents: list[dict[str, Any]],
) -> tuple[list[MatchedPair], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Match normalized events and documents by order_id (exact string match).

    Returns:
        matched              : sorted list of (event, document) tuples.
        missing_in_events    : sorted list of documents with no event counterpart.
        missing_in_documents : sorted list of events with no document counterpart.

    All output lists are sorted by order_id for deterministic ordering.
    Raises ValueError on duplicate order_ids within either input list.
    """
    events_index = _index_by_order_id(events, "events")
    docs_index = _index_by_order_id(documents, "documents")

    matched: list[MatchedPair] = []
    missing_in_documents: list[dict[str, Any]] = []

    for order_id, event in events_index.items():
        if order_id in docs_index:
            matched.append((event, docs_index[order_id]))
        else:
            missing_in_documents.append(event)

    missing_in_events: list[dict[str, Any]] = [
        doc for order_id, doc in docs_index.items()
        if order_id not in events_index
    ]

    # Sort all outputs for determinism
    matched.sort(key=lambda pair: pair[0]["order_id"])
    missing_in_events.sort(key=lambda r: r["order_id"])
    missing_in_documents.sort(key=lambda r: r["order_id"])

    logger.debug(
        "Matching complete: %d matched, %d missing_in_events, %d missing_in_documents.",
        len(matched),
        len(missing_in_events),
        len(missing_in_documents),
    )

    return matched, missing_in_events, missing_in_documents
