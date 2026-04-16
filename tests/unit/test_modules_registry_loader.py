import json
from pathlib import Path
from uuid import uuid4

from app.modules.registry_loader import load_modules_registry


def _contract_text(module_id: str, module_name: str, version: str) -> str:
    return (
        f"# Contract\n"
        f"* **module_id:** `{module_id}`\n"
        f"* **module_version:** `{version}`\n"
        f"* **nombre:** {module_name}\n"
    )


def _case_dir() -> Path:
    base_tmp = Path(".tmp_modules_registry")
    base_tmp.mkdir(parents=True, exist_ok=True)
    case_dir = base_tmp / f"case_{uuid4().hex}"
    case_dir.mkdir(parents=True, exist_ok=True)
    return case_dir


def _write_registry(case_dir: Path, payload: dict) -> str:
    registry_file = case_dir / "registry.json"
    registry_file.write_text(json.dumps(payload), encoding="utf-8")
    return str(registry_file.resolve())


def _write_contract(case_dir: Path, relative_path: str, module_id: str, module_name: str, version: str) -> None:
    contract_file = case_dir / relative_path
    contract_file.parent.mkdir(parents=True, exist_ok=True)
    contract_file.write_text(
        _contract_text(module_id=module_id, module_name=module_name, version=version),
        encoding="utf-8",
    )


def _base_module() -> dict:
    return {
        "module_id": "m1",
        "module_version": "1.0",
        "name": "Module 1",
        "status": "active",
        "category": "commercial_entry_module",
        "primary_entity": "client",
        "technical_complexity": "low",
        "doc_path": "contracts/m1.md",
    }


def test_cobranzas_vencidas_loads_from_real_registry() -> None:
    result = load_modules_registry("docs/product/modules/modules_registry_v1.json")
    loaded_ids = [module["module_id"] for module in result["loaded_modules"]]

    assert "cobranzas_vencidas" in loaded_ids


def test_doc_path_repo_root_relative() -> None:
    case_dir = _case_dir()
    module = _base_module()
    module["module_id"] = "cobranzas_vencidas"
    module["module_version"] = "1.0"
    module["name"] = "Cobranzas vencidas"
    module["doc_path"] = "docs/product/modules/cobranzas_vencidas_v1.md"
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert len(result["loaded_modules"]) == 1
    assert result["loaded_modules"][0]["module_id"] == "cobranzas_vencidas"


def test_valid_registry_loads_correctly() -> None:
    case_dir = _case_dir()
    module = _base_module()
    _write_contract(case_dir, module["doc_path"], module["module_id"], module["name"], module["module_version"])
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["registry_version"] == "1.0"
    assert len(result["loaded_modules"]) == 1
    assert result["loaded_modules"][0]["module_id"] == "m1"
    assert result["rejected_modules"] == []
    assert result["validation_errors"] == []


def test_doc_path_relative_to_registry_directory() -> None:
    case_dir = _case_dir()
    module = _base_module()
    _write_contract(case_dir, "contracts/m1.md", module["module_id"], module["name"], module["module_version"])
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert len(result["loaded_modules"]) == 1
    assert result["loaded_modules"][0]["module_id"] == "m1"


def test_duplicate_module_id_rejected() -> None:
    case_dir = _case_dir()
    module_1 = _base_module()
    module_2 = _base_module()
    module_2["doc_path"] = "contracts/m2.md"
    _write_contract(case_dir, module_1["doc_path"], module_1["module_id"], module_1["name"], module_1["module_version"])
    _write_contract(case_dir, module_2["doc_path"], module_2["module_id"], module_2["name"], module_2["module_version"])
    registry = {"registry_version": "1.0", "modules": [module_1, module_2]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert len(result["loaded_modules"]) == 1
    assert len(result["rejected_modules"]) == 1
    assert any(err["code"] == "duplicate_module_id" for err in result["validation_errors"])


def test_duplicate_doc_path_rejected() -> None:
    case_dir = _case_dir()
    module_1 = _base_module()
    module_2 = _base_module()
    module_2["module_id"] = "m2"
    _write_contract(case_dir, module_1["doc_path"], module_1["module_id"], module_1["name"], module_1["module_version"])
    registry = {"registry_version": "1.0", "modules": [module_1, module_2]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert len(result["loaded_modules"]) == 1
    assert len(result["rejected_modules"]) == 1
    assert any(err["code"] == "duplicate_doc_path" for err in result["validation_errors"])


def test_missing_required_field_rejected() -> None:
    case_dir = _case_dir()
    module = _base_module()
    del module["name"]
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert len(result["rejected_modules"]) == 1
    assert any(err["code"] == "missing_required_field" for err in result["validation_errors"])


def test_invalid_status_rejected() -> None:
    case_dir = _case_dir()
    module = _base_module()
    module["status"] = "running"
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert len(result["rejected_modules"]) == 1
    assert any(err["code"] == "invalid_status" for err in result["validation_errors"])


def test_invalid_technical_complexity_rejected() -> None:
    case_dir = _case_dir()
    module = _base_module()
    module["technical_complexity"] = "extreme"
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert len(result["rejected_modules"]) == 1
    assert any(err["code"] == "invalid_technical_complexity" for err in result["validation_errors"])


def test_inactive_modules_are_not_loaded() -> None:
    case_dir = _case_dir()
    active_module = _base_module()
    inactive_module = _base_module()
    inactive_module["module_id"] = "m2"
    inactive_module["doc_path"] = "contracts/m2.md"
    inactive_module["status"] = "inactive"
    _write_contract(
        case_dir,
        active_module["doc_path"],
        active_module["module_id"],
        active_module["name"],
        active_module["module_version"],
    )
    registry = {"registry_version": "1.0", "modules": [active_module, inactive_module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert len(result["loaded_modules"]) == 1
    assert result["loaded_modules"][0]["module_id"] == "m1"
    assert result["rejected_modules"] == []
    assert result["validation_errors"] == []


def test_registry_without_modules_fails_validation() -> None:
    case_dir = _case_dir()
    registry = {"registry_version": "1.0"}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert any(err["code"] == "invalid_modules" for err in result["validation_errors"])


def test_rejects_when_doc_path_does_not_exist() -> None:
    case_dir = _case_dir()
    module = _base_module()
    module["doc_path"] = "contracts/missing.md"
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert len(result["rejected_modules"]) == 1
    assert any(err["code"] == "module_doc_not_found" for err in result["validation_errors"])


def test_rejects_when_contract_metadata_does_not_match_registry() -> None:
    case_dir = _case_dir()
    module = _base_module()
    _write_contract(case_dir, module["doc_path"], module["module_id"], "Wrong Name", module["module_version"])
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert len(result["rejected_modules"]) == 1
    assert any(
        err["code"] == "module_contract_mismatch" and err.get("field") == "module_name"
        for err in result["validation_errors"]
    )


def test_schema_minimum_validation_module_version_required() -> None:
    case_dir = _case_dir()
    module = _base_module()
    contract_file = case_dir / module["doc_path"]
    contract_file.parent.mkdir(parents=True, exist_ok=True)
    contract_file.write_text(
        "# Contract\n* **module_id:** `m1`\n* **nombre:** Module 1\n",
        encoding="utf-8",
    )
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert any(
        err["code"] == "module_schema_required_field_missing" and err.get("field") == "version"
        for err in result["validation_errors"]
    )


def test_output_contract_is_preserved() -> None:
    case_dir = _case_dir()
    module = _base_module()
    _write_contract(case_dir, module["doc_path"], module["module_id"], module["name"], module["module_version"])
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert list(result.keys()) == [
        "loaded_modules",
        "rejected_modules",
        "validation_errors",
        "registry_version",
    ]


# ── Schema load / derivation error tests ─────────────────────────────────────

def test_schema_unreadable_rejects_all_active_modules(monkeypatch: "pytest.MonkeyPatch") -> None:
    """When module_schema_v1 cannot be read, all active modules must be rejected
    with code 'schema_load_error'. Silent pass is not acceptable."""
    import app.modules.registry_loader as loader_module

    nonexistent = Path("does/not/exist/module_schema_v1.md")
    monkeypatch.setattr(loader_module, "_SCHEMA_PATH", nonexistent)

    case_dir = _case_dir()
    module = _base_module()
    _write_contract(case_dir, module["doc_path"], module["module_id"], module["name"], module["module_version"])
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert len(result["rejected_modules"]) == 1
    assert result["rejected_modules"][0]["module_id"] == "m1"
    assert any(err["code"] == "schema_load_error" for err in result["validation_errors"])


def test_schema_with_no_derivable_fields_rejects_all_active_modules(
    monkeypatch: "pytest.MonkeyPatch", tmp_path: Path
) -> None:
    """When module_schema_v1 exists but contains none of the expected keywords,
    no required fields can be derived. All active modules must be rejected."""
    import app.modules.registry_loader as loader_module

    empty_schema = tmp_path / "module_schema_v1.md"
    empty_schema.write_text("# Schema placeholder — no fields declared yet.\n", encoding="utf-8")
    monkeypatch.setattr(loader_module, "_SCHEMA_PATH", empty_schema)

    case_dir = _case_dir()
    module = _base_module()
    _write_contract(case_dir, module["doc_path"], module["module_id"], module["name"], module["module_version"])
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert result["loaded_modules"] == []
    assert len(result["rejected_modules"]) == 1
    assert any(err["code"] == "schema_load_error" for err in result["validation_errors"])


def test_valid_schema_still_loads_module_correctly(
    monkeypatch: "pytest.MonkeyPatch", tmp_path: Path
) -> None:
    """Happy path: when schema is valid and module contract is consistent,
    module loads without errors. Output contract is preserved."""
    import app.modules.registry_loader as loader_module

    valid_schema = tmp_path / "module_schema_v1.md"
    valid_schema.write_text(
        "# Schema\n- module_id: required\n- module_version: required\n- name: required\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(loader_module, "_SCHEMA_PATH", valid_schema)

    case_dir = _case_dir()
    module = _base_module()
    _write_contract(case_dir, module["doc_path"], module["module_id"], module["name"], module["module_version"])
    registry = {"registry_version": "1.0", "modules": [module]}
    path = _write_registry(case_dir, registry)

    result = load_modules_registry(path)

    assert len(result["loaded_modules"]) == 1
    assert result["loaded_modules"][0]["module_id"] == "m1"
    assert result["rejected_modules"] == []
    assert result["validation_errors"] == []
    assert list(result.keys()) == ["loaded_modules", "rejected_modules", "validation_errors", "registry_version"]
