"""
engine.py
---------
Orchestration layer for the SmartBridge reconciliation pipeline.

Pipeline:
    normalize → match → diff → signals → final result

Public interface:
    reconcile_orders(events, documents) -> ReconciliationResult

Each step is a pure function. No shared state, no mutations.
"""

import logging
from typing import Any

from .normalizer import normalize_orders
from .matcher import match_orders
from .diff import diff_matched_orders
from .signals import generate_signals

logger = logging.getLogger(__name__)

# Canonical result structure (typed for clarity).
ReconciliationResult = dict[str, Any]


def reconcile_orders(
    events: list[dict[str, Any]],
    documents: list[dict[str, Any]],
) -> ReconciliationResult:
    """
    Run the full reconciliation pipeline against raw events and documents.

    Steps:
        1. Normalize: clean and validate all input records.
        2. Match:     align records by order_id.
        3. Diff:      detect field-level mismatches in matched pairs.
        4. Signals:   generate prioritized signal list.

    Returns a dict with keys:
        - matches               : list of {"event": ..., "document": ...}
        - mismatches            : list of mismatch dicts with reasons
        - missing_in_events     : normalized docs with no event counterpart
        - missing_in_documents  : normalized events with no doc counterpart
        - signals               : prioritized, sorted signal list

    Raises ValueError for invalid input records (propagated from sub-modules).
    """
    logger.info(
        "Reconciliation started: %d event(s), %d document(s).",
        len(events),
        len(documents),
    )

    # Step 1 — Normalize
    normalized_events = normalize_orders(events)
    normalized_docs = normalize_orders(documents)
    logger.info(
        "Normalization complete: %d event(s), %d document(s).",
        len(normalized_events),
        len(normalized_docs),
    )

    # Step 2 — Match
    matched_pairs, missing_in_events, missing_in_documents = match_orders(
        normalized_events, normalized_docs
    )

    # Step 3 — Diff
    mismatches = diff_matched_orders(matched_pairs)

    # Clean matches: pairs with no field differences.
    mismatched_ids: frozenset[str] = frozenset(m["order_id"] for m in mismatches)
    clean_matches: list[dict[str, Any]] = [
        {"event": event, "document": document}
        for event, document in matched_pairs
        if event["order_id"] not in mismatched_ids
    ]

    # Step 4 — Signals
    signals = generate_signals(mismatches, missing_in_events, missing_in_documents)

    logger.info(
        "Reconciliation complete: %d match(es), %d mismatch(es), "
        "%d missing_in_events, %d missing_in_documents, %d signal(s).",
        len(clean_matches),
        len(mismatches),
        len(missing_in_events),
        len(missing_in_documents),
        len(signals),
    )

    return {
        "matches": clean_matches,
        "mismatches": mismatches,
        "missing_in_events": missing_in_events,
        "missing_in_documents": missing_in_documents,
        "signals": signals,
    }
