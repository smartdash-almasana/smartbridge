import json
import logging
from collections import Counter
from typing import Any, Dict, List, Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)

VALID_STATUSES = {"paid", "pending", "cancelled"}


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


def _evaluate_amount_mismatch(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    amount = row.get("amount")
    expected_amount = row.get("expected_amount")

    if amount is None or amount == 0:
        return None

    if expected_amount is not None and amount != expected_amount:
        return _create_finding(
            "amount_mismatch",
            "high",
            f"Amount mismatch: got {amount}, expected {expected_amount}",
            row.get("entity_id"),
            row,
        )
    return None


def _evaluate_missing_amount(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    amount = row.get("amount")

    if amount is None or amount == 0:
        return _create_finding(
            "missing_amount",
            "medium",
            "Amount is missing or zero",
            row.get("entity_id"),
            row,
        )
    return None


def _evaluate_unknown_status(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    status = row.get("status")

    if status is not None:
        normalized_status = str(status).strip().lower()

        if normalized_status not in VALID_STATUSES:
            return _create_finding(
                "unknown_status",
                "low",
                f"Unrecognized status: '{status}'",
                row.get("entity_id"),
                row,
            )
    return None


def _get_duplicate_ids(rows: List[Dict[str, Any]]) -> set:
    ids = [str(row.get("order_id")) for row in rows if row.get("order_id") is not None]
    return {i for i, count in Counter(ids).items() if count > 1}


def _evaluate_duplicate_order(row: Dict[str, Any], duplicate_ids: set) -> Optional[Dict[str, Any]]:
    raw_order_id = row.get("order_id")

    if raw_order_id is None:
        return None

    order_id = str(raw_order_id)

    if order_id in duplicate_ids:
        return _create_finding(
            "duplicate_order",
            "high",
            f"Duplicate order detected for ID: {order_id}",
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
