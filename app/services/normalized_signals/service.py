"""
services/normalized_signals/service.py
--------------------------------------
Deterministic normalization of reconciliation findings into rankable signals.
"""

import hashlib
import json
from datetime import datetime
from typing import Any

NormalizedSignal = dict[str, Any]
NormalizedSignalsResult = dict[str, Any]
GroupedSignalData = dict[str, Any]

REQUIRED_PAYLOAD_FIELDS: tuple[str, ...] = (
    "module",
    "findings",
)

REQUIRED_FINDING_FIELDS: tuple[str, ...] = (
    "type",
    "severity",
    "entity_ref",
)

SEVERITY_BASE_SCORE: dict[str, int] = {
    "high": 80,
    "medium": 55,
    "low": 30,
}

SIGNAL_CODE_MODIFIER: dict[str, int] = {
    "order_mismatch": 12,
    "order_missing_in_events": 8,
    "order_missing_in_documents": 5,
    "stock_mismatch_detected": 10,
}

SIGNAL_CODE_ALIAS: dict[str, str] = {
    "order_mismatch": "order_mismatch",
    "order_missing_in_events": "order_missing_in_events",
    "order_missing_in_documents": "order_missing_in_documents",
    "amount_mismatch": "order_mismatch",
    "missing_invoice": "order_missing_in_documents",
    "stock_mismatch_detected": "stock_mismatch_detected",
}

ENTITY_IMPORTANCE_BY_KIND: dict[str, float] = {
    "order": 1.0,
}

FREQUENCY_STEP: int = 6
FREQUENCY_CAP: int = 24

HIGH_PRIORITY_THRESHOLD: int = 80
MEDIUM_PRIORITY_THRESHOLD: int = 50
SEVERITY_RANK: dict[str, int] = {
    "high": 3,
    "medium": 2,
    "low": 1,
}
REQUIRED_OUTPUT_KEYS: frozenset[str] = frozenset({"signals", "summary"})
REQUIRED_SIGNAL_KEYS: frozenset[str] = frozenset(
    {
        "signal_id",
        "signal_code",
        "severity",
        "priority_score",
        "entity_ref",
        "source_module",
        "ingestion_id",
        "created_at",
        "context",
    }
)
REQUIRED_SUMMARY_KEYS: frozenset[str] = frozenset(
    {"total_signals", "high_priority", "medium_priority", "low_priority"}
)


def _validate_iso8601(value: str, field_name: str) -> None:
    try:
        datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"Field '{field_name}' must be a valid ISO 8601 datetime string."
        ) from exc


def _validate_payload(payload: dict[str, Any], ingestion_id: str) -> None:
    if not isinstance(payload, dict):
        raise ValueError("Field 'payload' must be a dict.")

    if not isinstance(ingestion_id, str) or not ingestion_id.strip():
        raise ValueError("Field 'ingestion_id' must be a non-empty string.")

    missing = [field for field in REQUIRED_PAYLOAD_FIELDS if field not in payload]
    if missing:
        raise ValueError(
            "Payload is missing required field(s): " + ", ".join(missing)
        )

    if not isinstance(payload["module"], str) or not payload["module"].strip():
        raise ValueError("Field 'module' must be a non-empty string.")

    if "generated_at" in payload:
        if not isinstance(payload["generated_at"], str):
            raise ValueError("Field 'generated_at' must be a string.")
        _validate_iso8601(payload["generated_at"], "generated_at")

    if not isinstance(payload["findings"], list):
        raise ValueError("Field 'findings' must be a list.")


def _normalize_signal_code(raw_code: Any) -> str:
    if not isinstance(raw_code, str) or not raw_code.strip():
        raise ValueError("Field 'finding.type' must be a non-empty string.")
    signal_code = raw_code.strip().lower()
    if signal_code not in SIGNAL_CODE_ALIAS:
        raise ValueError(f"Unsupported finding type for signal mapping: '{signal_code}'.")
    return SIGNAL_CODE_ALIAS[signal_code]


def _normalize_severity(raw_severity: Any) -> str:
    if not isinstance(raw_severity, str) or not raw_severity.strip():
        raise ValueError("Field 'finding.severity' must be a non-empty string.")
    severity = raw_severity.strip().lower()
    if severity not in SEVERITY_BASE_SCORE:
        raise ValueError(f"Unsupported finding severity: '{severity}'.")
    return severity


def _normalize_context(raw_context: Any, message: Any) -> list[str]:
    if raw_context is None:
        if isinstance(message, str) and message.strip():
            return [message.strip()]
        return ["no_additional_context"]
    if not isinstance(raw_context, list):
        raise ValueError("Field 'finding.context' must be a list[str].")
    normalized: list[str] = []
    for item in raw_context:
        if not isinstance(item, str):
            raise ValueError("Field 'finding.context' must be a list[str].")
        if item.strip():
            normalized.append(item)
    return normalized if normalized else ["no_additional_context"]


def _entity_importance_modifier(entity_ref: str) -> int:
    if not isinstance(entity_ref, str) or not entity_ref.strip():
        raise ValueError("Field 'finding.entity_ref' must be a non-empty string.")
    if "_" not in entity_ref:
        raise ValueError(f"Invalid entity_ref format: '{entity_ref}'.")
    kind, _ = entity_ref.split("_", 1)
    kind_normalized = kind.strip().lower()
    if kind_normalized not in ENTITY_IMPORTANCE_BY_KIND:
        raise ValueError(f"Unsupported entity kind in entity_ref: '{entity_ref}'.")
    weight = ENTITY_IMPORTANCE_BY_KIND[kind_normalized]
    return int(round((weight - 1.0) * 10))


def _signal_id(
    ingestion_id: str,
    source_module: str,
    signal_code: str,
    entity_ref: str,
) -> str:
    canonical = json.dumps(
        {
            # Normalize only the ID input surface to keep identity stable
            # even if upstream sends case/whitespace variants.
            "entity_ref": entity_ref.strip().lower(),
            "ingestion_id": ingestion_id.strip(),
            "signal_code": signal_code.strip().lower(),
            "source_module": source_module.strip().lower(),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sig_{digest[:24]}"


def _priority_score(
    severity: str,
    signal_code: str,
    frequency: int,
    entity_ref: str,
) -> int:
    base = SEVERITY_BASE_SCORE[severity]
    code_modifier = SIGNAL_CODE_MODIFIER[signal_code]
    frequency_modifier = min((frequency - 1) * FREQUENCY_STEP, FREQUENCY_CAP)
    importance_modifier = _entity_importance_modifier(entity_ref)
    score = base + code_modifier + frequency_modifier + importance_modifier
    if score < 0:
        return 0
    if score > 100:
        return 100
    return score


def _priority_bucket(score: int) -> str:
    if score >= HIGH_PRIORITY_THRESHOLD:
        return "high"
    if score >= MEDIUM_PRIORITY_THRESHOLD:
        return "medium"
    return "low"


def _build_grouped_findings(
    findings: list[dict[str, Any]],
) -> dict[tuple[str, str], GroupedSignalData]:
    grouped: dict[tuple[str, str], GroupedSignalData] = {}

    def _merge_contexts(existing: list[str], incoming: list[str]) -> list[str]:
        combined = {
            item
            for item in (existing + incoming)
            if isinstance(item, str) and item.strip() and item != "no_additional_context"
        }
        if not combined:
            return ["no_additional_context"]
        return sorted(combined)

    for finding in findings:
        signal_code = _normalize_signal_code(finding["type"])
        severity = _normalize_severity(finding["severity"])
        entity_ref_raw = finding["entity_ref"]
        if not isinstance(entity_ref_raw, str) or not entity_ref_raw.strip():
            raise ValueError("Field 'finding.entity_ref' must be a non-empty string.")
        entity_ref = entity_ref_raw.strip()
        context = _normalize_context(finding.get("context"), finding.get("message"))

        key = (signal_code, entity_ref)
        group = grouped.get(key)
        if group is None:
            grouped[key] = {
                "frequency": 1,
                "representative": {
                    "signal_code": signal_code,
                    "severity": severity,
                    "entity_ref": entity_ref,
                    "context": context,
                },
            }
            continue

        group["frequency"] += 1
        current_rep = group["representative"]
        current_rank = SEVERITY_RANK[current_rep["severity"]]
        candidate_rank = SEVERITY_RANK[severity]
        merged_context = _merge_contexts(current_rep["context"], context)

        should_replace = False
        if candidate_rank > current_rank:
            should_replace = True
        elif candidate_rank == current_rank and merged_context < current_rep["context"]:
            should_replace = True

        if should_replace:
            group["representative"] = {
                "signal_code": signal_code,
                "severity": severity,
                "entity_ref": entity_ref,
                "context": merged_context,
            }
            continue

        current_rep["context"] = merged_context

    return grouped


def _validate_finding_shape(finding: dict[str, Any]) -> None:
    missing = [field for field in REQUIRED_FINDING_FIELDS if field not in finding]
    if missing:
        raise ValueError("Finding is missing required field(s): " + ", ".join(missing))


def _validate_output_contract(result: dict[str, Any]) -> None:
    if not isinstance(result, dict):
        raise ValueError("Output must be a dict.")

    result_keys = set(result.keys())
    if result_keys != REQUIRED_OUTPUT_KEYS:
        raise ValueError(
            "Output keys must be exactly: 'signals', 'summary'."
        )

    signals = result["signals"]
    if not isinstance(signals, list):
        raise ValueError("Field 'signals' must be a list.")

    for signal in signals:
        if not isinstance(signal, dict):
            raise ValueError("Each signal must be a dict.")

        signal_keys = set(signal.keys())
        if signal_keys != REQUIRED_SIGNAL_KEYS:
            raise ValueError(
                "Signal keys do not match required contract."
            )

        if not isinstance(signal["signal_id"], str) or not signal["signal_id"].strip():
            raise ValueError("Field 'signal_id' must be a non-empty string.")
        if not isinstance(signal["signal_code"], str):
            raise ValueError("Field 'signal_code' must be a string.")
        if not isinstance(signal["severity"], str):
            raise ValueError("Field 'severity' must be a string.")
        if not isinstance(signal["priority_score"], int):
            raise ValueError("Field 'priority_score' must be an int.")
        if not isinstance(signal["entity_ref"], str):
            raise ValueError("Field 'entity_ref' must be a string.")
        if not isinstance(signal["source_module"], str):
            raise ValueError("Field 'source_module' must be a string.")
        if not isinstance(signal["ingestion_id"], str):
            raise ValueError("Field 'ingestion_id' must be a string.")
        if not isinstance(signal["created_at"], str):
            raise ValueError("Field 'created_at' must be a string.")
        if signal["created_at"] != "1970-01-01T00:00:00+00:00":
            _validate_iso8601(signal["created_at"], "created_at")

        context = signal["context"]
        if not isinstance(context, list):
            raise ValueError("Field 'context' must be a list[str].")
        for item in context:
            if not isinstance(item, str):
                raise ValueError("Field 'context' must be a list[str].")

    summary = result["summary"]
    if not isinstance(summary, dict):
        raise ValueError("Field 'summary' must be a dict.")

    summary_keys = set(summary.keys())
    if summary_keys != REQUIRED_SUMMARY_KEYS:
        raise ValueError("Summary keys do not match required contract.")

    for key in REQUIRED_SUMMARY_KEYS:
        if not isinstance(summary[key], int):
            raise ValueError(f"Field '{key}' in summary must be an int.")


# ---------------------------------------------------------------------------
# Public mapping API — canonical source of truth for all callers
# (signals_engine.py, action_engine, etc. MUST delegate here)
# ---------------------------------------------------------------------------

#: Canonical action types per signal_code (superset of all callers).
_ACTION_TYPE_REGISTRY: dict[str, str] = {
    "order_mismatch": "review_order",
    "order_missing_in_documents": "request_document",
    "order_missing_in_events": "check_event_flow",
    "amount_missing_detected": "request_document",
    "invalid_status_detected": "manual_review",
    "duplicate_order_detected": "flag_duplicate",
    "data_quality_anomaly": "data_enrichment",
    "stock_mismatch_detected": "review_stock",
}


def map_signal_code(finding: dict[str, Any]) -> str:
    """
    Map finding.type → canonical signal_code.
    Delegates to the existing private normalizer.
    Raises ValueError for unsupported types.
    """
    return _normalize_signal_code(finding.get("type"))


def normalize_severity(level: str) -> str:
    """
    Normalize a raw severity string → 'high' | 'medium' | 'low'.
    Raises ValueError for unsupported levels.
    """
    return _normalize_severity(level)


def extract_entity_ref(finding: dict[str, Any]) -> str:
    """
    Extract a canonical entity_ref string from a finding dict.
    Uses entity_ref field; falls back to order_id inside metadata.
    Raises ValueError if no usable ref is found.
    """
    # Prefer explicit entity_ref
    entity_ref = finding.get("entity_ref")
    if isinstance(entity_ref, str) and entity_ref.strip():
        return entity_ref.strip()

    # Fallback: reconstruct from metadata
    metadata = finding.get("metadata") or {}
    order_id = metadata.get("order_id") or finding.get("entity_id")
    if order_id:
        return f"order_{order_id}"

    raise ValueError(
        f"Cannot extract entity_ref from finding: {finding!r}"
    )


def map_action_type(finding: dict[str, Any]) -> str:
    """
    Map finding → canonical action_type string.
    Raises ValueError for unmapped finding types.
    """
    signal_code = map_signal_code(finding)
    action_type = _ACTION_TYPE_REGISTRY.get(signal_code)
    if action_type is None:
        raise ValueError(
            f"No action mapping for signal_code '{signal_code}'."
        )
    return action_type


def build_normalized_signals(
    payload: dict[str, Any],
    ingestion_id: str,
) -> NormalizedSignalsResult:
    """
    Normalize module payload findings into a deterministic signals dataset.
    """
    _validate_payload(payload, ingestion_id)

    findings_any = payload["findings"]
    findings: list[dict[str, Any]] = []
    for item in findings_any:
        if not isinstance(item, dict):
            raise ValueError("Each finding entry must be a dict.")
        _validate_finding_shape(item)
        findings.append(item)

    grouped = _build_grouped_findings(findings)

    source_module = payload["module"].strip()
    created_at = payload.get("generated_at", "1970-01-01T00:00:00+00:00")
    ingestion_id_clean = ingestion_id.strip()

    signals: list[NormalizedSignal] = []

    for signal_code, entity_ref in sorted(grouped.keys()):
        group_data = grouped[(signal_code, entity_ref)]
        representative = group_data["representative"]
        severity = representative["severity"]
        context = representative["context"]
        frequency = group_data["frequency"]
        score = _priority_score(severity, signal_code, frequency, entity_ref)
        signal_id = _signal_id(
            ingestion_id=ingestion_id_clean,
            source_module=source_module,
            signal_code=signal_code,
            entity_ref=entity_ref,
        )

        signal: NormalizedSignal = {
            "signal_id": signal_id,
            "signal_code": signal_code,
            "severity": severity,
            "priority_score": score,
            "entity_ref": entity_ref,
            "source_module": source_module,
            "ingestion_id": ingestion_id_clean,
            "created_at": created_at,
            "context": context,
        }
        signals.append(signal)

    signals.sort(
        key=lambda s: (
            -s["priority_score"],
            s["signal_code"],
            s["entity_ref"],
            s["signal_id"],
        )
    )

    high_priority = 0
    medium_priority = 0
    low_priority = 0

    for signal in signals:
        bucket = _priority_bucket(signal["priority_score"])
        if bucket == "high":
            high_priority += 1
        elif bucket == "medium":
            medium_priority += 1
        else:
            low_priority += 1

    result: NormalizedSignalsResult = {
        "signals": signals,
        "summary": {
            "total_signals": len(signals),
            "high_priority": high_priority,
            "medium_priority": medium_priority,
            "low_priority": low_priority,
        },
    }
    _validate_output_contract(result)
    return result
