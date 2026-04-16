from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

import pytest

import app.catalog.loader as catalog_loader


def test_load_catalog_from_repo_files() -> None:
    data = catalog_loader.load_catalog()
    assert isinstance(data["schema"], dict)
    assert isinstance(data["rules"], list)
    assert isinstance(data["tenant_overrides"], list)
    assert len(data["rules"]) > 0


def test_get_effective_rules_applies_tenant_override() -> None:
    rules = catalog_loader.get_effective_rules("pyme_ecommerce_001")
    unknown_status = next(r for r in rules if r["rule_id"] == "unknown_status")
    assert unknown_status["severity"] == "low"
    assert "fulfilled" in unknown_status["condition"]["valid_values"]
    assert "refunded" in unknown_status["condition"]["valid_values"]


def test_get_effective_rules_without_tenant_returns_base_rules() -> None:
    base = catalog_loader.load_rules()
    effective = catalog_loader.get_effective_rules()
    assert effective == base


def test_load_catalog_fail_fast_missing_required_rule_field() -> None:
    workdir = _build_temp_catalog(
        rules=[
            {
                # rule_id intentionally missing
                "description": "bad rule",
                "enabled": True,
                "applies_to": {"module": ["findings_engine"], "entity_type": "order"},
                "condition": {"type": "null_or_zero", "field": "amount"},
                "severity": "low",
                "health_penalty_weight": None,
                "block_on_uncertainty": False,
                "output": {
                    "finding_type": "bad_rule",
                    "message_template": "bad",
                    "traceability_fields": ["amount"],
                },
                "policy_overrideable": ["enabled"],
            }
        ],
        overrides=[],
    )
    try:
        _patch_catalog_paths(workdir)
        with pytest.raises(catalog_loader.CatalogValidationError, match="rule_id"):
            catalog_loader.load_rules()
    finally:
        _restore_catalog_paths()
        shutil.rmtree(workdir, ignore_errors=True)


def test_load_tenant_overrides_fail_fast_for_non_overrideable_field() -> None:
    workdir = _build_temp_catalog(
        rules=[
            {
                "rule_id": "r1",
                "description": "rule",
                "enabled": True,
                "applies_to": {"module": ["findings_engine"], "entity_type": "order"},
                "condition": {"type": "null_or_zero", "field": "amount"},
                "severity": "low",
                "health_penalty_weight": None,
                "block_on_uncertainty": False,
                "output": {
                    "finding_type": "r1",
                    "message_template": "rule",
                    "traceability_fields": ["amount"],
                },
                "policy_overrideable": ["enabled"],
            }
        ],
        overrides=[
            {
                "tenant_id": "t1",
                "rule_id": "r1",
                "overrides": {"severity": "high"},  # not in policy_overrideable
            }
        ],
    )
    try:
        _patch_catalog_paths(workdir)
        with pytest.raises(catalog_loader.CatalogValidationError, match="not allowed"):
            catalog_loader.load_tenant_overrides()
    finally:
        _restore_catalog_paths()
        shutil.rmtree(workdir, ignore_errors=True)


_ORIGINAL_RULES_PATH = catalog_loader.RULES_PATH
_ORIGINAL_OVERRIDES_PATH = catalog_loader.TENANT_OVERRIDES_PATH
_ORIGINAL_SCHEMA_PATH = catalog_loader.SCHEMA_PATH


def _patch_catalog_paths(workdir: Path) -> None:
    catalog_loader.RULES_PATH = workdir / "rules.v2.json"
    catalog_loader.TENANT_OVERRIDES_PATH = workdir / "tenant_overrides.v2.json"
    catalog_loader.SCHEMA_PATH = workdir / "schema.v2.json"


def _restore_catalog_paths() -> None:
    catalog_loader.RULES_PATH = _ORIGINAL_RULES_PATH
    catalog_loader.TENANT_OVERRIDES_PATH = _ORIGINAL_OVERRIDES_PATH
    catalog_loader.SCHEMA_PATH = _ORIGINAL_SCHEMA_PATH


def _build_temp_catalog(rules: list[dict], overrides: list[dict]) -> Path:
    root = Path("data") / f"tmp_catalog_loader_tests_{uuid.uuid4().hex}"
    root.mkdir(parents=True, exist_ok=True)

    schema = {
        "version": "2.0",
        "severity_enum": ["low", "medium", "high", "critical"],
        "condition_types": [
            "set_membership",
            "numeric_comparison",
            "null_or_zero",
            "duplicate_key",
            "cross_source_field_diff",
            "absence_in_source",
        ],
    }

    (root / "schema.v2.json").write_text(json.dumps(schema), encoding="utf-8")
    (root / "rules.v2.json").write_text(json.dumps(rules), encoding="utf-8")
    (root / "tenant_overrides.v2.json").write_text(json.dumps(overrides), encoding="utf-8")
    return root
