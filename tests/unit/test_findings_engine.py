from copy import deepcopy

from app.services import findings_engine


def test_build_findings_detects_all_core_conditions() -> None:
    rows = [
        {
            "entity_id": "E-1",
            "order_id": "A-1",
            "amount": 100,
            "expected_amount": 90,
            "status": "paid",
        },
        {
            "entity_id": "E-2",
            "order_id": "A-2",
            "amount": 0,
            "expected_amount": 50,
            "status": "pending",
        },
        {
            "entity_id": "E-3",
            "order_id": "A-2",
            "amount": 10,
            "expected_amount": 10,
            "status": "UNKNOWN",
        },
    ]

    findings = findings_engine.build_findings(rows)
    finding_types = [f["type"] for f in findings]

    assert finding_types == [
        "amount_mismatch",
        "missing_amount",
        "duplicate_order",
        "unknown_status",
        "duplicate_order",
    ]


def test_build_findings_skips_non_dict_after_duplicate_scan() -> None:
    rows = [{"order_id": "A-1", "amount": 10, "expected_amount": 10, "status": "paid", "entity_id": "E1"}]
    findings = findings_engine.build_findings(rows)
    assert findings == []


def test_build_findings_handles_invalid_top_level_input() -> None:
    assert findings_engine.build_findings([]) == []
    assert findings_engine.build_findings(None) == []  # type: ignore[arg-type]
    try:
        findings_engine.build_findings("not-a-list")  # type: ignore[arg-type]
        assert False, "Expected AttributeError"
    except AttributeError:
        assert True

    try:
        findings_engine.build_findings([{"order_id": "A-1"}, "bad"])  # type: ignore[list-item]
        assert False, "Expected AttributeError"
    except AttributeError:
        assert True


def test_unknown_status_accepts_valid_status_with_whitespace_and_case() -> None:
    row = {"status": "  PAID  ", "entity_id": "E-1"}
    assert findings_engine._evaluate_unknown_status(row) is None


def test_duplicate_id_detection_normalizes_to_strings() -> None:
    rows = [
        {"order_id": 7},
        {"order_id": "7"},
        {"order_id": "8"},
        {"order_id": None},
    ]
    duplicates = findings_engine._get_duplicate_ids(rows)
    assert duplicates == {"7"}


def test_amount_mismatch_reads_message_and_severity_from_catalog(monkeypatch) -> None:
    catalog_rules = _build_catalog_rules()
    catalog_rules[1]["severity"] = "critical"
    catalog_rules[1]["output"]["message_template"] = "DIFF {field_a} vs {field_b}"

    monkeypatch.setattr(findings_engine, "get_effective_rules", lambda tenant_id=None: catalog_rules)
    findings_engine._load_rule_index.cache_clear()
    try:
        row = {"entity_id": "E-1", "amount": 10, "expected_amount": 20}
        finding = findings_engine._evaluate_amount_mismatch(row)
    finally:
        findings_engine._load_rule_index.cache_clear()

    assert finding is not None
    assert finding["severity"] == "critical"
    assert finding["description"] == "DIFF 10 vs 20"
    assert finding["type"] == "amount_mismatch"


def test_disabled_rule_from_catalog_skips_detection(monkeypatch) -> None:
    catalog_rules = _build_catalog_rules()
    catalog_rules[2]["enabled"] = False

    monkeypatch.setattr(findings_engine, "get_effective_rules", lambda tenant_id=None: catalog_rules)
    findings_engine._load_rule_index.cache_clear()
    try:
        row = {"entity_id": "E-2", "amount": 0}
        finding = findings_engine._evaluate_missing_amount(row)
    finally:
        findings_engine._load_rule_index.cache_clear()

    assert finding is None


def _build_catalog_rules() -> list[dict]:
    return deepcopy(
        [
            {
                "rule_id": "unknown_status",
                "enabled": True,
                "severity": "low",
                "applies_to": {"module": ["findings_engine"], "entity_type": "order"},
                "condition": {"type": "set_membership", "field": "status", "valid_values": ["paid", "pending", "cancelled"]},
                "output": {
                    "finding_type": "unknown_status",
                    "message_template": "Unrecognized status: '{value}'",
                    "traceability_fields": ["status"],
                },
                "policy_overrideable": ["enabled", "severity", "condition.valid_values"],
                "description": "x",
                "health_penalty_weight": None,
                "block_on_uncertainty": False,
            },
            {
                "rule_id": "amount_mismatch",
                "enabled": True,
                "severity": "high",
                "applies_to": {"module": ["findings_engine"], "entity_type": "order"},
                "condition": {"type": "numeric_comparison", "field_a": "amount", "field_b": "expected_amount"},
                "output": {
                    "finding_type": "amount_mismatch",
                    "message_template": "Amount mismatch: got {field_a}, expected {field_b}",
                    "traceability_fields": ["amount", "expected_amount"],
                },
                "policy_overrideable": ["enabled", "severity"],
                "description": "x",
                "health_penalty_weight": None,
                "block_on_uncertainty": False,
            },
            {
                "rule_id": "missing_amount",
                "enabled": True,
                "severity": "medium",
                "applies_to": {"module": ["findings_engine"], "entity_type": "order"},
                "condition": {"type": "null_or_zero", "field": "amount"},
                "output": {
                    "finding_type": "missing_amount",
                    "message_template": "Amount is missing or zero",
                    "traceability_fields": ["amount"],
                },
                "policy_overrideable": ["enabled", "severity"],
                "description": "x",
                "health_penalty_weight": None,
                "block_on_uncertainty": False,
            },
            {
                "rule_id": "duplicate_order",
                "enabled": True,
                "severity": "high",
                "applies_to": {"module": ["findings_engine"], "entity_type": "order"},
                "condition": {"type": "duplicate_key", "field": "order_id"},
                "output": {
                    "finding_type": "duplicate_order",
                    "message_template": "Duplicate order detected for ID: {order_id}",
                    "traceability_fields": ["order_id"],
                },
                "policy_overrideable": ["enabled", "severity"],
                "description": "x",
                "health_penalty_weight": None,
                "block_on_uncertainty": False,
            },
        ]
    )
