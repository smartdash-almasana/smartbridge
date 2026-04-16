from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any


CATALOG_DIR = Path(__file__).resolve().parent
RULES_PATH = CATALOG_DIR / "rules.v2.json"
TENANT_OVERRIDES_PATH = CATALOG_DIR / "tenant_overrides.v2.json"
SCHEMA_PATH = CATALOG_DIR / "schema.v2.json"


class CatalogValidationError(ValueError):
    """Raised when catalog files are missing required structure."""


def load_catalog() -> dict[str, Any]:
    schema = _load_schema()
    rules = _load_rules(schema)
    overrides = _load_tenant_overrides(schema, rules)
    return {
        "schema": schema,
        "rules": rules,
        "tenant_overrides": overrides,
    }


def load_rules() -> list[dict[str, Any]]:
    schema = _load_schema()
    return _load_rules(schema)


def load_tenant_overrides() -> list[dict[str, Any]]:
    schema = _load_schema()
    rules = _load_rules(schema)
    return _load_tenant_overrides(schema, rules)


def get_effective_rules(tenant_id: str | None = None) -> list[dict[str, Any]]:
    schema = _load_schema()
    base_rules = _load_rules(schema)
    if tenant_id is None:
        return copy.deepcopy(base_rules)

    tenant = str(tenant_id).strip()
    if tenant == "":
        raise CatalogValidationError("tenant_id must be a non-empty string when provided.")

    overrides = _load_tenant_overrides(schema, base_rules)
    indexed = {r["rule_id"]: copy.deepcopy(r) for r in base_rules}

    for entry in overrides:
        if entry["tenant_id"] != tenant:
            continue
        rule = indexed[entry["rule_id"]]
        for key, value in entry["overrides"].items():
            _set_by_dotted_path(rule, key, copy.deepcopy(value))

    return [indexed[r["rule_id"]] for r in base_rules]


def _load_schema() -> dict[str, Any]:
    schema = _read_json(SCHEMA_PATH, "schema.v2.json")
    if not isinstance(schema, dict):
        raise CatalogValidationError("schema.v2.json must be an object.")

    version = schema.get("version")
    if not isinstance(version, str) or not version.strip():
        raise CatalogValidationError("schema.v2.json: missing required string field 'version'.")

    severity_enum = schema.get("severity_enum")
    if not isinstance(severity_enum, list) or not severity_enum:
        raise CatalogValidationError("schema.v2.json: 'severity_enum' must be a non-empty list.")
    if not all(isinstance(x, str) and x.strip() for x in severity_enum):
        raise CatalogValidationError("schema.v2.json: every 'severity_enum' item must be a non-empty string.")

    condition_types = schema.get("condition_types")
    if not isinstance(condition_types, list) or not condition_types:
        raise CatalogValidationError("schema.v2.json: 'condition_types' must be a non-empty list.")
    if not all(isinstance(x, str) and x.strip() for x in condition_types):
        raise CatalogValidationError("schema.v2.json: every 'condition_types' item must be a non-empty string.")

    return schema


def _load_rules(schema: dict[str, Any]) -> list[dict[str, Any]]:
    raw = _read_json(RULES_PATH, "rules.v2.json")
    if not isinstance(raw, list):
        raise CatalogValidationError("rules.v2.json must be an array.")

    if not raw:
        raise CatalogValidationError("rules.v2.json must contain at least one rule.")

    severity_enum = set(schema["severity_enum"])
    condition_types = set(schema["condition_types"])
    seen_rule_ids: set[str] = set()

    validated: list[dict[str, Any]] = []
    for idx, item in enumerate(raw):
        path = f"rules.v2.json[{idx}]"
        if not isinstance(item, dict):
            raise CatalogValidationError(f"{path} must be an object.")

        rule_id = _require_non_empty_str(item, "rule_id", path)
        if rule_id in seen_rule_ids:
            raise CatalogValidationError(f"{path}: duplicate rule_id '{rule_id}'.")
        seen_rule_ids.add(rule_id)

        _require_non_empty_str(item, "description", path)
        _require_bool(item, "enabled", path)
        _require_bool(item, "block_on_uncertainty", path)

        applies_to = item.get("applies_to")
        if not isinstance(applies_to, dict):
            raise CatalogValidationError(f"{path}.applies_to must be an object.")

        module_list = applies_to.get("module")
        if not isinstance(module_list, list) or not module_list:
            raise CatalogValidationError(f"{path}.applies_to.module must be a non-empty list.")
        if not all(isinstance(x, str) and x.strip() for x in module_list):
            raise CatalogValidationError(f"{path}.applies_to.module must only contain non-empty strings.")
        _require_non_empty_str(applies_to, "entity_type", f"{path}.applies_to")

        condition = item.get("condition")
        if not isinstance(condition, dict):
            raise CatalogValidationError(f"{path}.condition must be an object.")
        condition_type = _require_non_empty_str(condition, "type", f"{path}.condition")
        if condition_type not in condition_types:
            raise CatalogValidationError(f"{path}.condition.type '{condition_type}' is not in schema.condition_types.")

        severity = _require_non_empty_str(item, "severity", path)
        if severity not in severity_enum:
            raise CatalogValidationError(f"{path}.severity '{severity}' is not in schema.severity_enum.")

        hpw = item.get("health_penalty_weight")
        if hpw is not None and (not isinstance(hpw, (int, float)) or isinstance(hpw, bool)):
            raise CatalogValidationError(f"{path}.health_penalty_weight must be number or null.")

        output = item.get("output")
        if not isinstance(output, dict):
            raise CatalogValidationError(f"{path}.output must be an object.")
        _require_non_empty_str(output, "finding_type", f"{path}.output")
        _require_non_empty_str(output, "message_template", f"{path}.output")
        traceability_fields = output.get("traceability_fields")
        if not isinstance(traceability_fields, list) or not traceability_fields:
            raise CatalogValidationError(f"{path}.output.traceability_fields must be a non-empty list.")
        if not all(isinstance(x, str) and x.strip() for x in traceability_fields):
            raise CatalogValidationError(f"{path}.output.traceability_fields must contain non-empty strings.")

        policy_overrideable = item.get("policy_overrideable")
        if not isinstance(policy_overrideable, list):
            raise CatalogValidationError(f"{path}.policy_overrideable must be an array.")
        if not all(isinstance(x, str) and x.strip() for x in policy_overrideable):
            raise CatalogValidationError(f"{path}.policy_overrideable must contain non-empty strings.")

        validated.append(copy.deepcopy(item))

    return validated


def _load_tenant_overrides(
    schema: dict[str, Any],
    rules: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    raw = _read_json(TENANT_OVERRIDES_PATH, "tenant_overrides.v2.json")
    if not isinstance(raw, list):
        raise CatalogValidationError("tenant_overrides.v2.json must be an array.")

    severity_enum = set(schema["severity_enum"])
    rules_by_id = {r["rule_id"]: r for r in rules}
    seen_pairs: set[tuple[str, str]] = set()
    validated: list[dict[str, Any]] = []

    for idx, item in enumerate(raw):
        path = f"tenant_overrides.v2.json[{idx}]"
        if not isinstance(item, dict):
            raise CatalogValidationError(f"{path} must be an object.")

        tenant_id = _require_non_empty_str(item, "tenant_id", path)
        rule_id = _require_non_empty_str(item, "rule_id", path)
        if rule_id not in rules_by_id:
            raise CatalogValidationError(f"{path}.rule_id '{rule_id}' does not exist in rules.v2.json.")

        pair = (tenant_id, rule_id)
        if pair in seen_pairs:
            raise CatalogValidationError(f"{path}: duplicate override for tenant_id='{tenant_id}' rule_id='{rule_id}'.")
        seen_pairs.add(pair)

        overrides = item.get("overrides")
        if not isinstance(overrides, dict) or not overrides:
            raise CatalogValidationError(f"{path}.overrides must be a non-empty object.")

        base_rule = rules_by_id[rule_id]
        allowed_keys = set(base_rule.get("policy_overrideable", []))
        normalized_overrides: dict[str, Any] = {}

        for key, value in overrides.items():
            if key not in allowed_keys:
                raise CatalogValidationError(
                    f"{path}.overrides.{key} is not allowed by policy_overrideable for rule '{rule_id}'."
                )

            if key == "enabled":
                if not isinstance(value, bool):
                    raise CatalogValidationError(f"{path}.overrides.enabled must be bool.")
            elif key == "severity":
                if not isinstance(value, str) or value not in severity_enum:
                    raise CatalogValidationError(f"{path}.overrides.severity must be one of schema.severity_enum.")
            elif key == "health_penalty_weight":
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    raise CatalogValidationError(f"{path}.overrides.health_penalty_weight must be numeric.")
            elif key == "condition.valid_values":
                if not isinstance(value, list) or not value:
                    raise CatalogValidationError(f"{path}.overrides.condition.valid_values must be a non-empty list.")
                if not all(isinstance(x, str) and x.strip() for x in value):
                    raise CatalogValidationError(
                        f"{path}.overrides.condition.valid_values must contain non-empty strings."
                    )
            else:
                if value is None:
                    raise CatalogValidationError(f"{path}.overrides.{key} must not be null.")

            normalized_overrides[key] = copy.deepcopy(value)

        validated.append(
            {
                "tenant_id": tenant_id,
                "rule_id": rule_id,
                "overrides": normalized_overrides,
            }
        )

    return validated


def _read_json(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError as exc:
        raise CatalogValidationError(f"{label} not found at '{path}'.") from exc
    except json.JSONDecodeError as exc:
        raise CatalogValidationError(f"{label} is not valid JSON: {exc.msg}.") from exc


def _require_non_empty_str(data: dict[str, Any], key: str, path: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise CatalogValidationError(f"{path}.{key} must be a non-empty string.")
    return value


def _require_bool(data: dict[str, Any], key: str, path: str) -> None:
    if not isinstance(data.get(key), bool):
        raise CatalogValidationError(f"{path}.{key} must be bool.")


def _set_by_dotted_path(target: dict[str, Any], dotted_path: str, value: Any) -> None:
    keys = dotted_path.split(".")
    cursor: Any = target
    for part in keys[:-1]:
        if not isinstance(cursor, dict) or part not in cursor or not isinstance(cursor[part], dict):
            raise CatalogValidationError(f"Cannot apply override. Missing nested path '{dotted_path}'.")
        cursor = cursor[part]
    if not isinstance(cursor, dict):
        raise CatalogValidationError(f"Cannot apply override. Invalid container for '{dotted_path}'.")
    cursor[keys[-1]] = value
