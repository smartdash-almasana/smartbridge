import json
import logging
from collections import Counter
from functools import lru_cache
from typing import Any, Dict, List, Optional

from app.catalog import get_effective_rules

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)

_SUPPORTED_RULE_IDS = {
    "unknown_status",
    "amount_mismatch",
    "missing_amount",
    "duplicate_order",
}


def _create_finding(
    type_: str,
    severity: str,
    description: str,
    entity_id: Optional[str],
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "type": type_,
        "severity": severity,
        "description": description,
        "entity_id": entity_id,
        "metadata": metadata,
    }


@lru_cache(maxsize=1)
def _load_rule_index() -> Dict[str, Dict[str, Any]]:
    rules = get_effective_rules()
    index: Dict[str, Dict[str, Any]] = {}

    for rule in rules:
        applies_to = rule.get("applies_to", {})
        modules = applies_to.get("module", [])

        if "findings_engine" not in modules:
            continue

        rule_id = rule.get("rule_id")
        if isinstance(rule_id, str) and rule_id in _SUPPORTED_RULE_IDS:
            index[rule_id] = rule

    missing = sorted(_SUPPORTED_RULE_IDS - set(index.keys()))
    if missing:
        raise ValueError(f"Catalog missing findings_engine rules: {missing}")

    return index


def _get_rule(rule_id: str) -> Dict[str, Any]:
    rules = _load_rule_index()
    rule = rules.get(rule_id)
    if rule is None:
        raise ValueError(f"Rule '{rule_id}' is not available in findings_engine catalog slice.")
    return rule


def _is_rule_enabled(rule_id: str) -> bool:
    return bool(_get_rule(rule_id).get("enabled", False))


def _rule_finding_type(rule_id: str) -> str:
    output = _get_rule(rule_id).get("output", {})
    finding_type = output.get("finding_type")
    if not isinstance(finding_type, str) or not finding_type.strip():
        raise ValueError(f"Rule '{rule_id}' is missing output.finding_type.")
    return finding_type


def _rule_severity(rule_id: str) -> str:
    severity = _get_rule(rule_id).get("severity")
    if not isinstance(severity, str) or not severity.strip():
        raise ValueError(f"Rule '{rule_id}' is missing severity.")
    return severity


def _rule_message(rule_id: str, **values: Any) -> str:
    output = _get_rule(rule_id).get("output", {})
    template = output.get("message_template")
    if not isinstance(template, str) or not template.strip():
        raise ValueError(f"Rule '{rule_id}' is missing output.message_template.")

    try:
        return template.format(**values)
    except KeyError as exc:
        raise ValueError(f"Rule '{rule_id}' message_template missing key: {exc}") from exc


def _unknown_status_valid_values() -> set[str]:
    condition = _get_rule("unknown_status").get("condition", {})
    valid_values = condition.get("valid_values")
    if not isinstance(valid_values, list) or not valid_values:
        raise ValueError("Rule 'unknown_status' is missing condition.valid_values.")

    normalized: set[str] = set()
    for value in valid_values:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Rule 'unknown_status' has invalid value in condition.valid_values.")
        normalized.add(value.strip().lower())

    return normalized


def _evaluate_amount_mismatch(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not _is_rule_enabled("amount_mismatch"):
        return None

    amount = row.get("amount")
    expected_amount = row.get("expected_amount")

    if amount is None or amount == 0:
        return None

    if expected_amount is not None and amount != expected_amount:
        return _create_finding(
            _rule_finding_type("amount_mismatch"),
            _rule_severity("amount_mismatch"),
            _rule_message("amount_mismatch", field_a=amount, field_b=expected_amount),
            row.get("entity_id"),
            row,
        )
    return None


def _evaluate_missing_amount(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not _is_rule_enabled("missing_amount"):
        return None

    amount = row.get("amount")

    if amount is None or amount == 0:
        return _create_finding(
            _rule_finding_type("missing_amount"),
            _rule_severity("missing_amount"),
            _rule_message("missing_amount"),
            row.get("entity_id"),
            row,
        )
    return None


def _evaluate_unknown_status(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not _is_rule_enabled("unknown_status"):
        return None

    status = row.get("status")

    if status is not None:
        normalized_status = str(status).strip().lower()

        if normalized_status not in _unknown_status_valid_values():
            return _create_finding(
                _rule_finding_type("unknown_status"),
                _rule_severity("unknown_status"),
                _rule_message("unknown_status", value=status),
                row.get("entity_id"),
                row,
            )
    return None


def _get_duplicate_ids(rows: List[Dict[str, Any]]) -> set:
    ids = [str(row.get("order_id")) for row in rows if row.get("order_id") is not None]
    return {i for i, count in Counter(ids).items() if count > 1}


def _evaluate_duplicate_order(row: Dict[str, Any], duplicate_ids: set) -> Optional[Dict[str, Any]]:
    if not _is_rule_enabled("duplicate_order"):
        return None

    raw_order_id = row.get("order_id")

    if raw_order_id is None:
        return None

    order_id = str(raw_order_id)

    if order_id in duplicate_ids:
        return _create_finding(
            _rule_finding_type("duplicate_order"),
            _rule_severity("duplicate_order"),
            _rule_message("duplicate_order", order_id=order_id),
            row.get("entity_id"),
            row,
        )
    return None


def build_findings(rows: List[Dict]) -> List[Dict]:
    if not rows:
        return []

    findings: List[Dict[str, Any]] = []
    duplicate_ids = _get_duplicate_ids(rows)

    for row in rows:
        if not isinstance(row, dict):
            continue

        if f := _evaluate_amount_mismatch(row):
            findings.append(f)

        if f := _evaluate_missing_amount(row):
            findings.append(f)

        if f := _evaluate_unknown_status(row):
            findings.append(f)

        if f := _evaluate_duplicate_order(row, duplicate_ids):
            findings.append(f)

    return findings


if __name__ == "__main__":
    SAMPLE_ROWS = [
        {"entity_id":"E1","order_id":"A1","amount":100,"expected_amount":90,"status":"paid"},
        {"entity_id":"E2","order_id":"A2","amount":0,"expected_amount":50,"status":"pending"},
        {"entity_id":"E3","order_id":"A3","amount":50,"expected_amount":50,"status":"invalid_status"},
        {"entity_id":"E4","order_id":"A2","amount":10,"expected_amount":10,"status":"paid"},
        {"entity_id":None,"order_id":None,"amount":None,"expected_amount":20,"status":"cancelled"},
        {"entity_id":"E5","order_id":"A5","amount":100,"expected_amount":100,"status":" PAID "}
    ]

    results = build_findings(SAMPLE_ROWS)
    print(json.dumps(results, indent=2))
