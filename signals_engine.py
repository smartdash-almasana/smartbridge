from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List

from app.services.normalized_signals import (
    map_signal_code as _ns_map_signal_code,
    normalize_severity as _ns_normalize_severity,
)


# ---------------------------------------------------------------------------
# DEPRECATED: mapping registries below are superseded by
# app.services.normalized_signals (canonical source of truth).
# DO NOT add new entries here — update normalized_signals/service.py instead.
# These are kept temporarily to avoid breaking any direct callers.
# ---------------------------------------------------------------------------

SIGNAL_CODE_MAPPING: Dict[str, str] = {  # DEPRECATED
    "order_mismatch": "order_mismatch_detected",
    "amount_mismatch": "order_mismatch_detected",
    "missing_amount": "amount_missing_detected",
    "unknown_status": "invalid_status_detected",
    "duplicate_order": "duplicate_order_detected",
    "data_anomaly": "data_quality_anomaly",
}

SEVERITY_MAPPING: Dict[str, str] = {  # DEPRECATED
    "critical": "high",
    "high": "high",
    "warning": "medium",
    "medium": "medium",
    "info": "low",
    "low": "low",
}

ACTION_TYPE_MAPPING: Dict[str, str] = {  # DEPRECATED
    "order_mismatch": "review_required",
    "amount_mismatch": "review_required",
    "missing_amount": "request_document",
    "unknown_status": "manual_review",
    "duplicate_order": "flag_duplicate",
    "data_anomaly": "data_enrichment",
}


# ---------------------------------------------------------------------------
# CORE HELPERS — delegate to normalized_signals (single source of truth)
# ---------------------------------------------------------------------------

def normalize_priority(level: str) -> str:
    # DEPRECATED — kept for backward compat with direct callers.
    try:
        return _ns_normalize_severity(level)
    except ValueError:
        return "low"


def extract_entity_id(finding: Dict[str, Any], index: int) -> str:
    """Internal helper: build an entity_ref string from a raw finding."""
    metadata = finding.get("metadata") or {}

    if metadata.get("order_id"):
        return f"order_{metadata['order_id']}"

    if metadata.get("document_id"):
        return f"order_{metadata['document_id']}"

    if finding.get("entity_id"):
        return f"order_{finding['entity_id']}"

    payload = json.dumps(finding, sort_keys=True) + f":{index}"
    return f"order_ref_{hashlib.sha256(payload.encode()).hexdigest()[:8]}"


def map_action_type(finding_type: str) -> str:
    # DEPRECATED — kept for backward compat with direct callers.
    try:
        from app.services.normalized_signals import map_action_type as _ns_map_action_type
        return _ns_map_action_type({"type": finding_type})
    except ValueError:
        return ACTION_TYPE_MAPPING.get(finding_type, "manual_review")


# ---------------------------------------------------------------------------
# CORE TRANSFORM
# ---------------------------------------------------------------------------

def map_finding_to_signal(
    finding: Dict[str, Any],
    tenant_id: str,
    module: str,
    index: int,
    created_at: str,
) -> Dict[str, Any]:
    """
    Thin adapter: finding → canonical signal contract.

    Output contract (matches global_signals + normalized_signals requirements):
        signal_code   : str
        entity_ref    : str   (format: "order_<id>")
        source_module : str
        severity      : 'high' | 'medium' | 'low'
        created_at    : str
        context       : list[str]
    """
    finding_type = str(finding.get("type", "unknown")).strip().lower()

    # Route through canonical mapping; fall back to prefixed custom code.
    try:
        signal_code = _ns_map_signal_code({"type": finding_type})
    except (ValueError, AttributeError):
        signal_code = SIGNAL_CODE_MAPPING.get(finding_type, f"custom_{finding_type}_detected")

    severity = _ns_normalize_severity(
        finding.get("severity", "low")
    ) if isinstance(finding.get("severity"), str) else "low"

    entity_ref = extract_entity_id(finding, index)  # already returns "order_*" format

    description = finding.get("description") or finding.get("message", "")
    context: list[str] = [description] if description else ["no_additional_context"]

    return {
        "signal_code": signal_code,
        "entity_ref": entity_ref,
        "source_module": module,
        "severity": severity,
        "created_at": created_at,
        "context": context,
    }


def build_signals(
    findings: List[Dict[str, Any]],
    tenant_id: str,
    module: str,
    created_at: str,
) -> List[Dict[str, Any]]:

    if created_at is None:
        raise ValueError("created_at is required for deterministic signals")

    if not isinstance(findings, list):
        return []

    signals: List[Dict[str, Any]] = []

    for idx, finding in enumerate(findings):
        if not isinstance(finding, dict):
            continue

        signals.append(
            map_finding_to_signal(
                finding,
                tenant_id,
                module,
                idx,
                created_at
            )
        )

    return signals


# ---------------------------------------------------------------------------
# TEST
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json

    SAMPLE_FINDINGS = [
        {
            "type": "order_mismatch",
            "severity": "critical",
            "entity_id": "E1",
            "metadata": {"order_id": "123"},
        },
        {
            "type": "missing_amount",
            "severity": "warning",
            "entity_id": "E2",
            "metadata": {"document_id": "DOC-99"},
        },
        {
            "type": "duplicate_order",
            "severity": "info",
            "entity_id": "E3",
            "metadata": {"order_id": "123"},
        }
    ]

    FIXED_TS = "2026-01-01T00:00:00Z"

    signals = build_signals(
        findings=SAMPLE_FINDINGS,
        tenant_id="tenant_acme",
        module="reconciliation",
        created_at=FIXED_TS
    )

    print(json.dumps(signals, indent=2))
