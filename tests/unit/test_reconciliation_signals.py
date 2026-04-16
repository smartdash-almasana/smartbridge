from copy import deepcopy

from app.services.reconciliation import signals as reconciliation_signals


def test_generate_signals_reads_severity_from_catalog(monkeypatch) -> None:
    catalog_rules = _build_reconciliation_catalog_rules()
    catalog_rules[0]["severity"] = "critical"

    monkeypatch.setattr(reconciliation_signals, "get_effective_rules", lambda tenant_id=None: catalog_rules)
    reconciliation_signals._load_reconciliation_rule_index.cache_clear()
    try:
        output = reconciliation_signals.generate_signals(
            mismatches=[{"order_id": "A-1", "reasons": ["amount differs"]}],
            missing_in_events=[],
            missing_in_documents=[],
        )
    finally:
        reconciliation_signals._load_reconciliation_rule_index.cache_clear()

    assert len(output) == 1
    assert output[0]["type"] == "order_mismatch"
    assert output[0]["severity"] == "critical"
    assert output[0]["order_id"] == "A-1"
    assert output[0]["details"] == ["amount differs"]


def test_generate_signals_skips_disabled_catalog_rule(monkeypatch) -> None:
    catalog_rules = _build_reconciliation_catalog_rules()
    catalog_rules[2]["enabled"] = False  # order_missing_in_documents

    monkeypatch.setattr(reconciliation_signals, "get_effective_rules", lambda tenant_id=None: catalog_rules)
    reconciliation_signals._load_reconciliation_rule_index.cache_clear()
    try:
        output = reconciliation_signals.generate_signals(
            mismatches=[],
            missing_in_events=[],
            missing_in_documents=[{"order_id": "A-9"}],
        )
    finally:
        reconciliation_signals._load_reconciliation_rule_index.cache_clear()

    assert output == []


def _build_reconciliation_catalog_rules() -> list[dict]:
    return deepcopy(
        [
            {
                "rule_id": "order_mismatch",
                "enabled": True,
                "severity": "high",
                "applies_to": {"module": ["reconciliation"], "entity_type": "order"},
                "condition": {
                    "type": "cross_source_field_diff",
                    "match_key": "order_id",
                    "source_a": "events",
                    "source_b": "documents",
                    "diff_fields": ["status", "total_amount"],
                },
                "output": {
                    "finding_type": "order_mismatch",
                    "message_template": "Order data mismatch between events and documents",
                    "traceability_fields": ["order_id", "diff_reasons"],
                },
                "policy_overrideable": ["enabled", "severity", "health_penalty_weight"],
                "description": "x",
                "health_penalty_weight": 10,
                "block_on_uncertainty": False,
            },
            {
                "rule_id": "order_missing_in_events",
                "enabled": True,
                "severity": "high",
                "applies_to": {"module": ["reconciliation"], "entity_type": "order"},
                "condition": {
                    "type": "absence_in_source",
                    "match_key": "order_id",
                    "present_in": "documents",
                    "absent_from": "events",
                },
                "output": {
                    "finding_type": "order_missing_in_events",
                    "message_template": "Order present in documents but missing in events",
                    "traceability_fields": ["order_id"],
                },
                "policy_overrideable": ["enabled", "severity", "health_penalty_weight"],
                "description": "x",
                "health_penalty_weight": 10,
                "block_on_uncertainty": False,
            },
            {
                "rule_id": "order_missing_in_documents",
                "enabled": True,
                "severity": "medium",
                "applies_to": {"module": ["reconciliation"], "entity_type": "order"},
                "condition": {
                    "type": "absence_in_source",
                    "match_key": "order_id",
                    "present_in": "events",
                    "absent_from": "documents",
                },
                "output": {
                    "finding_type": "order_missing_in_documents",
                    "message_template": "Order present in events but missing in documents",
                    "traceability_fields": ["order_id"],
                },
                "policy_overrideable": ["enabled", "severity", "health_penalty_weight"],
                "description": "x",
                "health_penalty_weight": 10,
                "block_on_uncertainty": False,
            },
        ]
    )
