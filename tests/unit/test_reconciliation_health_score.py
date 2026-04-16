from copy import deepcopy

from app.services.reconciliation import module_adapter


def test_compute_health_score_uses_catalog_weights(monkeypatch) -> None:
    catalog_rules = _build_reconciliation_catalog_rules()
    catalog_rules[0]["health_penalty_weight"] = 7
    catalog_rules[1]["health_penalty_weight"] = 11
    catalog_rules[2]["health_penalty_weight"] = 13

    monkeypatch.setattr(module_adapter, "get_effective_rules", lambda tenant_id=None: catalog_rules)
    module_adapter._load_health_penalty_weights.cache_clear()
    try:
        score = module_adapter.compute_health_score(
            summary={"total_signals": 3},
            signals=[
                {"type": "order_mismatch"},
                {"type": "order_missing_in_events"},
                {"type": "order_missing_in_documents"},
            ],
        )
    finally:
        module_adapter._load_health_penalty_weights.cache_clear()

    assert score == 69  # 100 - (7 + 11 + 13)


def test_build_summary_uses_signal_types_for_health_score(monkeypatch) -> None:
    catalog_rules = _build_reconciliation_catalog_rules()
    catalog_rules[0]["health_penalty_weight"] = 8
    catalog_rules[1]["health_penalty_weight"] = 5
    catalog_rules[2]["health_penalty_weight"] = 3

    monkeypatch.setattr(module_adapter, "get_effective_rules", lambda tenant_id=None: catalog_rules)
    module_adapter._load_health_penalty_weights.cache_clear()
    try:
        result = {
            "matches": [],
            "mismatches": [{"order_id": "A1"}],
            "missing_in_events": [{"order_id": "A2"}],
            "missing_in_documents": [],
            "signals": [
                {"type": "order_mismatch", "order_id": "A1"},
                {"type": "order_missing_in_events", "order_id": "A2"},
            ],
        }
        summary = module_adapter.build_summary(result)
    finally:
        module_adapter._load_health_penalty_weights.cache_clear()

    assert summary["total_signals"] == 2
    assert summary["health_score"] == 87  # 100 - (8 + 5)


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
