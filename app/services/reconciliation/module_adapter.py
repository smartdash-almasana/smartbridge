"""
module_adapter.py
-----------------
Transforms raw ReconciliationResult output into the SmartCounter module
ingestion contract.

Public interface:
    build_reconciliation_module_payload(events, documents) -> ModulePayload

Internal helpers are strictly pure functions with no side effects.
The engine is called exactly once per invocation.
"""

import logging
from functools import lru_cache
from typing import Any
from app.catalog import get_effective_rules
from app.core.time_provider import get_current_timestamp

from .engine import reconcile_orders, ReconciliationResult
from .constants import (
    ACTION_CREATE_DOCUMENTS,
    ACTION_CREATE_EVENTS,
    ACTION_PRIORITY,
    ACTION_REVIEW_MISMATCHES,
    HEALTH_SCORE_MAX,
    MODULE_ID,
    SEVERITY_ORDER,
    SIGNAL_MISSING_IN_DOCUMENTS,
    SIGNAL_MISSING_IN_EVENTS,
    SIGNAL_ORDER_MISMATCH,
    SOURCE_TYPE,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

ModulePayload = dict[str, Any]
Finding = dict[str, Any]
Summary = dict[str, Any]
Action = dict[str, Any]

FINDING_MESSAGE_MAP: dict[str, str] = {
    "order_missing_in_events": (
        "Order present in documents but missing in events"
    ),
    "order_missing_in_documents": (
        "Order present in events but missing in documents"
    ),
    "order_mismatch": "Order data mismatch between events and documents",
}

_HEALTH_WEIGHT_RULE_IDS: tuple[str, ...] = (
    "order_mismatch",
    "order_missing_in_events",
    "order_missing_in_documents",
)
_DEFAULT_UNKNOWN_SIGNAL_PENALTY: int = 0


# ---------------------------------------------------------------------------
# Time helper
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return get_current_timestamp()


# ---------------------------------------------------------------------------
# Finding helpers
# ---------------------------------------------------------------------------

def _entity_ref(order_id: str) -> str:
    """Stable entity reference format: 'order_<id>'."""
    return f"order_{order_id}"


def _finding_id(signal_type: str, order_id: str) -> str:
    """
    Deterministic finding ID: 'fnd_<signal_type>_order_<order_id>'.
    Using this format ensures the ID is stable across identical inputs.
    """
    return f"fnd_{signal_type}_{_entity_ref(order_id)}"


def transform_signals_to_findings(result: ReconciliationResult) -> list[Finding]:
    """
    Convert each signal in the reconciliation result to a Finding record.

    Finding schema:
        finding_id  : deterministic string ID
        type        : signal type (from constants)
        severity    : high | medium | low
        entity_ref  : "order_<id>"
        context     : list of reason strings (may be empty)

    Output is sorted by: severity rank, then entity_ref.
    """
    findings: list[Finding] = []

    def _safe_context(details: Any) -> list[str]:
        if isinstance(details, list):
            context = [str(item) for item in details if str(item).strip()]
            return context or ["no_additional_context"]
        return ["no_additional_context"]

    for signal in result.get("signals", []):
        order_id: str = signal["order_id"]
        findings.append(
            {
                "finding_id": _finding_id(signal["type"], order_id),
                "type": signal["type"],
                "severity": signal["severity"],
                "message": FINDING_MESSAGE_MAP.get(
                    signal["type"], "Order reconciliation issue detected"
                ),
                "entity_ref": _entity_ref(order_id),
                "context": _safe_context(signal.get("details")),
            }
        )

    # Sort: severity (high first), then entity_ref lexicographic
    findings.sort(
        key=lambda f: (SEVERITY_ORDER.get(f["severity"], 99), f["entity_ref"])
    )
    return findings


# ---------------------------------------------------------------------------
# Summary helpers
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_health_penalty_weights() -> dict[str, int]:
    rules = get_effective_rules()
    weights: dict[str, int] = {}

    for rule in rules:
        rule_id = rule.get("rule_id")
        applies_to = rule.get("applies_to", {})
        modules = applies_to.get("module", [])

        if not isinstance(rule_id, str):
            continue
        if rule_id not in _HEALTH_WEIGHT_RULE_IDS:
            continue
        if "reconciliation" not in modules:
            continue

        weight = rule.get("health_penalty_weight")
        if not isinstance(weight, (int, float)) or isinstance(weight, bool):
            raise ValueError(f"Catalog rule '{rule_id}' must define numeric health_penalty_weight.")
        weights[rule_id] = int(weight)

    missing = sorted(set(_HEALTH_WEIGHT_RULE_IDS) - set(weights.keys()))
    if missing:
        raise ValueError(f"Catalog missing health_penalty_weight for rules: {missing}")

    return weights


def compute_health_score(
    summary: Summary,
    signals: list[dict[str, Any]] | None = None,
) -> int:
    """
    Compute a health score from 0 to 100.

    Formula:
        health_score = max(0, HEALTH_SCORE_MAX - sum(weight(signal_type)))

    Where:
        HEALTH_SCORE_MAX = 100  (see constants.py)
        weight(signal_type) comes from catalog health_penalty_weight.

    A score of 100 means no issues were detected.
    Each signal reduces the score by its configured rule weight.
    The score is clamped to a minimum of 0.
    """
    if not signals:
        return HEALTH_SCORE_MAX

    weights = _load_health_penalty_weights()
    penalty = 0

    for signal in signals:
        signal_type = signal.get("type")
        if isinstance(signal_type, str):
            penalty += weights.get(signal_type, _DEFAULT_UNKNOWN_SIGNAL_PENALTY)
        else:
            penalty += _DEFAULT_UNKNOWN_SIGNAL_PENALTY

    return max(0, HEALTH_SCORE_MAX - penalty)


def build_summary(result: ReconciliationResult) -> Summary:
    """
    Build a structured summary from the engine result.

    Does NOT derive totals by counting input lists — it uses only
    data already computed by the engine to avoid inconsistency.
    """
    summary: Summary = {
        "total_matched": len(result.get("matches", [])),
        "total_mismatched": len(result.get("mismatches", [])),
        "missing_in_events": len(result.get("missing_in_events", [])),
        "missing_in_documents": len(result.get("missing_in_documents", [])),
        "total_signals": len(result.get("signals", [])),
    }
    summary["health_score"] = compute_health_score(summary, result.get("signals", []))
    return summary


# ---------------------------------------------------------------------------
# Action helpers
# ---------------------------------------------------------------------------

def _collect_order_ids(records: list[dict[str, Any]]) -> list[str]:
    """Return a sorted list of order_id strings from a list of records."""
    return sorted(r["order_id"] for r in records)


def _priority_from_severity(severity: str) -> str:
    """Convert a severity label to an action priority label."""
    if severity == "high":
        return "high"
    if severity == "medium":
        return "medium"
    return "low"


def _action_context(
    signal_type: str,
    severity: str,
    result: ReconciliationResult,
    relevant_count_key: str,
    relevant_count_value: int,
) -> dict[str, Any]:
    """Build future-proof context with both local and summary reconciliation counts."""
    return {
        "signal_type": signal_type,
        "severity": severity,
        "counts": {
            relevant_count_key: relevant_count_value,
            "total_mismatched": len(result.get("mismatches", [])),
            "missing_in_events": len(result.get("missing_in_events", [])),
            "missing_in_documents": len(result.get("missing_in_documents", [])),
            "total_signals": len(result.get("signals", [])),
        }
    }


def build_actions(result: ReconciliationResult) -> list[Action]:
    """
    Build a list of suggested remediation actions from the engine result.

    Each action:
        action_type : one of ACTION_* constants
        description : human-readable explanation
        entities    : sorted list of affected order_ids

    Output is sorted by ACTION_PRIORITY for determinism.
    Actions are only included when the relevant list is non-empty.
    """
    actions: list[Action] = []

    missing_in_events: list[dict[str, Any]] = result.get("missing_in_events", [])
    missing_in_documents: list[dict[str, Any]] = result.get("missing_in_documents", [])
    mismatches: list[dict[str, Any]] = result.get("mismatches", [])

    if missing_in_events:
        severity = "high"
        actions.append(
            {
                "action_type": ACTION_CREATE_EVENTS,
                "priority": _priority_from_severity(severity),
                "origin": MODULE_ID,
                "entity_refs": [
                    _entity_ref(order_id)
                    for order_id in _collect_order_ids(missing_in_events)
                ],
                "context": _action_context(
                    SIGNAL_MISSING_IN_EVENTS,
                    severity,
                    result, "missing_in_events", len(missing_in_events)
                ),
                "description": (
                    f"Create {len(missing_in_events)} missing event(s) "
                    "found only in documents."
                ),
            }
        )

    if missing_in_documents:
        severity = "medium"
        actions.append(
            {
                "action_type": ACTION_CREATE_DOCUMENTS,
                "priority": _priority_from_severity(severity),
                "origin": MODULE_ID,
                "entity_refs": [
                    _entity_ref(order_id)
                    for order_id in _collect_order_ids(missing_in_documents)
                ],
                "context": _action_context(
                    SIGNAL_MISSING_IN_DOCUMENTS,
                    severity,
                    result, "missing_in_documents", len(missing_in_documents)
                ),
                "description": (
                    f"Generate {len(missing_in_documents)} document(s) "
                    "missing for existing events."
                ),
            }
        )

    if mismatches:
        severity = "high"
        actions.append(
            {
                "action_type": ACTION_REVIEW_MISMATCHES,
                "priority": _priority_from_severity(severity),
                "origin": MODULE_ID,
                "entity_refs": [
                    _entity_ref(order_id)
                    for order_id in sorted(m["order_id"] for m in mismatches)
                ],
                "context": _action_context(
                    SIGNAL_ORDER_MISMATCH,
                    severity,
                    result, "total_mismatched", len(mismatches)
                ),
                "description": (
                    f"Review {len(mismatches)} order(s) with "
                    "status or amount discrepancies."
                ),
            }
        )

    # Sort by explicit priority order
    actions.sort(
        key=lambda a: (
            SEVERITY_ORDER.get(a.get("priority", "low"), 99),
            ACTION_PRIORITY.get(a["action_type"], 99),
        )
    )
    return actions


# ---------------------------------------------------------------------------
# Canonical rows helpers
# ---------------------------------------------------------------------------

def _append_canonical_row(
    rows_by_key: dict[tuple[str, str], dict[str, Any]],
    record: dict[str, Any],
    source: str,
    present_in_events: bool,
    present_in_documents: bool,
    is_mismatch: bool,
) -> None:
    """Insert one canonical row keyed by (order_id, source) for deduped output."""
    order_id = record["order_id"]
    rows_by_key[(order_id, source)] = {
        "order_id": order_id,
        "source": source,
        "status": record["status"],
        "total_amount": float(record["total_amount"]),
        "present_in_events": present_in_events,
        "present_in_documents": present_in_documents,
        "is_mismatch": is_mismatch,
    }


def build_canonical_rows(result: ReconciliationResult) -> list[dict[str, Any]]:
    """
    Build complete canonical rows from normalized engine output.

    Includes:
        - clean matches
        - missing_in_events
        - missing_in_documents
        - mismatches

    Output is de-duplicated and sorted by (order_id, source).
    """
    rows_by_key: dict[tuple[str, str], dict[str, Any]] = {}

    for pair in result.get("matches", []):
        event = pair["event"]
        document = pair["document"]
        _append_canonical_row(rows_by_key, event, "event", True, True, False)
        _append_canonical_row(rows_by_key, document, "document", True, True, False)

    for mismatch in result.get("mismatches", []):
        event = mismatch["event"]
        document = mismatch["document"]
        _append_canonical_row(rows_by_key, event, "event", True, True, True)
        _append_canonical_row(rows_by_key, document, "document", True, True, True)

    for doc in result.get("missing_in_events", []):
        _append_canonical_row(rows_by_key, doc, "document", False, True, False)

    for event in result.get("missing_in_documents", []):
        _append_canonical_row(rows_by_key, event, "event", True, False, False)

    rows = list(rows_by_key.values())
    rows.sort(key=lambda r: (r["order_id"], r["source"]))
    return rows


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_reconciliation_module_payload(
    events: list[dict[str, Any]],
    documents: list[dict[str, Any]],
    tenant_id: str = "demo001",
) -> ModulePayload:
    """
    Run the reconciliation engine and wrap the result in the SmartCounter
    module ingestion contract.

    Args:
        events:    raw event records from SmartSeller.
        documents: raw document records from SmartCounter.
        tenant_id: identifier for the requesting tenant (default: "demo001").

    Returns a ModulePayload dict matching the SmartCounter factory contract:
        {
            "tenant_id":        str,
            "module":           str,
            "source_type":      str,
            "generated_at":     ISO 8601 UTC string,
            "canonical_rows":   list of clean matched pairs,
            "findings":         sorted finding list,
            "summary":          aggregated counters + health_score,
            "suggested_actions": prioritized action list,
        }
    """
    logger.info(
        "Building module payload for tenant '%s': %d event(s), %d document(s).",
        tenant_id,
        len(events),
        len(documents),
    )

    result: ReconciliationResult = reconcile_orders(events, documents)

    payload: ModulePayload = {
        "tenant_id": tenant_id,
        "module": MODULE_ID,
        "source_type": SOURCE_TYPE,
        "generated_at": _now_iso(),
        "canonical_rows": build_canonical_rows(result),
        "findings": transform_signals_to_findings(result),
        "summary": build_summary(result),
        "suggested_actions": build_actions(result),
    }

    logger.info(
        "Module payload built: health_score=%d, %d finding(s), %d action(s).",
        payload["summary"]["health_score"],
        len(payload["findings"]),
        len(payload["suggested_actions"]),
    )

    return payload


