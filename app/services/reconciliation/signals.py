"""
signals.py
----------
Pure signal generation from reconciliation diff results.

Signal rules:
- order_mismatch            → severity: high
- order_missing_in_events   → severity: high
- order_missing_in_documents → severity: medium

Returns a deterministically sorted list: severity (high first), then order_id.
"""

import logging
from typing import Any

from .constants import (
    SEVERITY_HIGH,
    SEVERITY_MEDIUM,
    SEVERITY_ORDER,
    SIGNAL_MISSING_IN_DOCUMENTS,
    SIGNAL_MISSING_IN_EVENTS,
    SIGNAL_ORDER_MISMATCH,
)

logger = logging.getLogger(__name__)


def _make_signal(
    signal_type: str,
    severity: str,
    order_id: str,
    details: list[str] | None = None,
) -> dict[str, Any]:
    """
    Construct a single signal record.
    details is included only when non-empty.
    """
    signal: dict[str, Any] = {
        "type": signal_type,
        "severity": severity,
        "order_id": order_id,
    }
    if details:
        signal["details"] = details
    return signal


def generate_signals(
    mismatches: list[dict[str, Any]],
    missing_in_events: list[dict[str, Any]],
    missing_in_documents: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Generate a sorted list of signals from the reconciliation diff.

    Sort order: severity (high → medium → low), then order_id ascending.

    Args:
        mismatches:            output from diff_matched_orders()
        missing_in_events:     docs with no matching event
        missing_in_documents:  events with no matching document

    Returns:
        list of signal dicts, deterministically ordered.
    """
    signals: list[dict[str, Any]] = []

    for mismatch in mismatches:
        signals.append(
            _make_signal(
                SIGNAL_ORDER_MISMATCH,
                SEVERITY_HIGH,
                mismatch["order_id"],
                details=mismatch.get("reasons"),
            )
        )

    for doc in missing_in_events:
        signals.append(
            _make_signal(SIGNAL_MISSING_IN_EVENTS, SEVERITY_HIGH, doc["order_id"])
        )

    for event in missing_in_documents:
        signals.append(
            _make_signal(SIGNAL_MISSING_IN_DOCUMENTS, SEVERITY_MEDIUM, event["order_id"])
        )

    # Sort: severity rank first, then order_id lexicographic
    signals.sort(
        key=lambda s: (SEVERITY_ORDER.get(s["severity"], 99), s["order_id"])
    )

    logger.debug("Signal generation complete: %d signal(s).", len(signals))
    return signals
