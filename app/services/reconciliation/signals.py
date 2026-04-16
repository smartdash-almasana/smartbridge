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
from functools import lru_cache
from typing import Any

from app.catalog import get_effective_rules
from .constants import (
    SEVERITY_ORDER,
)

logger = logging.getLogger(__name__)

_SUPPORTED_RULE_IDS = {
    "order_mismatch",
    "order_missing_in_events",
    "order_missing_in_documents",
}


@lru_cache(maxsize=1)
def _load_reconciliation_rule_index() -> dict[str, dict[str, Any]]:
    rules = get_effective_rules()
    index: dict[str, dict[str, Any]] = {}

    for rule in rules:
        applies_to = rule.get("applies_to", {})
        modules = applies_to.get("module", [])
        if "reconciliation" not in modules:
            continue

        rule_id = rule.get("rule_id")
        if isinstance(rule_id, str) and rule_id in _SUPPORTED_RULE_IDS:
            index[rule_id] = rule

    missing = sorted(_SUPPORTED_RULE_IDS - set(index.keys()))
    if missing:
        raise ValueError(f"Catalog missing reconciliation rules: {missing}")

    return index


def _get_rule(rule_id: str) -> dict[str, Any]:
    rules = _load_reconciliation_rule_index()
    rule = rules.get(rule_id)
    if rule is None:
        raise ValueError(f"Rule '{rule_id}' is not available in reconciliation catalog slice.")
    return rule


def _is_rule_enabled(rule_id: str) -> bool:
    return bool(_get_rule(rule_id).get("enabled", False))


def _rule_signal_type(rule_id: str) -> str:
    output = _get_rule(rule_id).get("output", {})
    signal_type = output.get("finding_type")
    if not isinstance(signal_type, str) or not signal_type.strip():
        raise ValueError(f"Rule '{rule_id}' is missing output.finding_type.")
    return signal_type


def _rule_severity(rule_id: str) -> str:
    severity = _get_rule(rule_id).get("severity")
    if not isinstance(severity, str) or not severity.strip():
        raise ValueError(f"Rule '{rule_id}' is missing severity.")
    return severity


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

    if _is_rule_enabled("order_mismatch"):
        for mismatch in mismatches:
            signals.append(
                _make_signal(
                    _rule_signal_type("order_mismatch"),
                    _rule_severity("order_mismatch"),
                    mismatch["order_id"],
                    details=mismatch.get("reasons"),
                )
            )

    if _is_rule_enabled("order_missing_in_events"):
        for doc in missing_in_events:
            signals.append(
                _make_signal(
                    _rule_signal_type("order_missing_in_events"),
                    _rule_severity("order_missing_in_events"),
                    doc["order_id"],
                )
            )

    if _is_rule_enabled("order_missing_in_documents"):
        for event in missing_in_documents:
            signals.append(
                _make_signal(
                    _rule_signal_type("order_missing_in_documents"),
                    _rule_severity("order_missing_in_documents"),
                    event["order_id"],
                )
            )

    # Sort: severity rank first, then order_id lexicographic
    signals.sort(
        key=lambda s: (SEVERITY_ORDER.get(s["severity"], 99), s["order_id"])
    )

    logger.debug("Signal generation complete: %d signal(s).", len(signals))
    return signals
