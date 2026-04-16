import json
import re
from json import JSONDecodeError
from pathlib import Path

from app.modules.registry_validator import validate_modules_registry


_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCHEMA_PATH = _REPO_ROOT / "docs" / "product" / "modules" / "module_schema_v1.md"
_MODULE_ID_RE = re.compile(r"\*\*module_id:\*\*\s*`([^`]+)`", re.IGNORECASE)
_MODULE_VERSION_RE = re.compile(r"\*\*module_version:\*\*\s*`([^`]+)`", re.IGNORECASE)
_MODULE_NAME_RE = re.compile(r"\*\*(?:nombre|name):\*\*\s*`?([^\n`]+?)`?(?:\n|\r|$|\s+-\s+\*\*)", re.IGNORECASE)


def _resolve_doc_path(registry_path: str, doc_path: str) -> Path:
    registry_file = Path(registry_path).resolve()
    doc_candidate = Path(doc_path)
    if doc_candidate.is_absolute():
        return doc_candidate

    repo_relative = (_REPO_ROOT / doc_candidate).resolve()
    if repo_relative.exists():
        return repo_relative

    registry_relative = (registry_file.parent / doc_candidate).resolve()
    if registry_relative.exists():
        return registry_relative

    if str(doc_candidate).startswith("docs/") or str(doc_candidate).startswith("docs\\"):
        return repo_relative
    return registry_relative


def _parse_contract_metadata(contract_text: str) -> dict:
    module_id_match = _MODULE_ID_RE.search(contract_text)
    module_version_match = _MODULE_VERSION_RE.search(contract_text)
    module_name_match = _MODULE_NAME_RE.search(contract_text)

    return {
        "module_id": module_id_match.group(1).strip() if module_id_match else None,
        "version": module_version_match.group(1).strip() if module_version_match else None,
        "module_name": module_name_match.group(1).strip() if module_name_match else None,
    }


def _load_schema_required_metadata_fields() -> tuple[str, ...] | None:
    """Return the minimal required metadata fields derived from module_schema_v1.

    Returns None when the schema cannot be read or when no required fields
    can be derived (both cases must block module loading, not silently pass).
    """
    try:
        schema_text = _SCHEMA_PATH.read_text(encoding="utf-8").lower()
    except OSError:
        return None

    required = []
    if "module_id" in schema_text:
        required.append("module_id")
    if "module_version" in schema_text:
        required.append("version")
    if "name" in schema_text:
        required.append("module_name")

    if not required:
        return None

    return tuple(required)


def load_modules_registry(registry_path: str) -> dict:
    result = {
        "loaded_modules": [],
        "rejected_modules": [],
        "validation_errors": [],
        "registry_version": None,
    }

    try:
        with open(registry_path, "r", encoding="utf-8") as file_obj:
            registry_data = json.load(file_obj)
    except OSError as error:
        result["validation_errors"].append(
            {
                "code": "registry_read_error",
                "message": str(error),
                "path": registry_path,
            }
        )
        return result
    except JSONDecodeError as error:
        result["validation_errors"].append(
            {
                "code": "invalid_registry_json",
                "message": str(error),
                "path": registry_path,
            }
        )
        return result

    validation = validate_modules_registry(registry_data)
    schema_required_fields = _load_schema_required_metadata_fields()
    result["registry_version"] = validation.get("registry_version")
    result["rejected_modules"] = list(validation.get("rejected_modules", []))
    result["validation_errors"] = list(validation.get("validation_errors", []))

    if schema_required_fields is None:
        schema_error = {
            "code": "schema_load_error",
            "message": (
                "module_schema_v1 could not be read or yielded no required fields. "
                "All active modules are rejected until the schema is available."
            ),
            "path": str(_SCHEMA_PATH),
        }
        result["validation_errors"].append(schema_error)
        for module in validation.get("valid_modules", []):
            if module.get("status") == "active":
                result["rejected_modules"].append(module)
        return result

    for module in validation.get("valid_modules", []):
        if module.get("status") != "active":
            continue

        resolved_doc_path = _resolve_doc_path(registry_path, module["doc_path"])
        if not resolved_doc_path.exists():
            result["rejected_modules"].append(module)
            result["validation_errors"].append(
                {
                    "code": "module_doc_not_found",
                    "message": f"Module contract not found: {module['doc_path']}",
                    "path": module["doc_path"],
                    "module_id": module.get("module_id"),
                }
            )
            continue

        try:
            contract_text = resolved_doc_path.read_text(encoding="utf-8")
        except OSError as error:
            result["rejected_modules"].append(module)
            result["validation_errors"].append(
                {
                    "code": "module_doc_read_error",
                    "message": str(error),
                    "path": str(resolved_doc_path),
                    "module_id": module.get("module_id"),
                }
            )
            continue

        metadata = _parse_contract_metadata(contract_text)
        metadata_errors = []

        for field_name in schema_required_fields:
            if not metadata.get(field_name):
                metadata_errors.append(
                    {
                        "code": "module_schema_required_field_missing",
                        "message": f"{field_name} required by module_schema_v1.",
                        "path": str(resolved_doc_path),
                        "module_id": module.get("module_id"),
                        "field": field_name,
                    }
                )

        if metadata["module_id"] != module.get("module_id"):
            metadata_errors.append(
                {
                    "code": "module_contract_mismatch",
                    "message": "module_id mismatch between registry and contract.",
                    "path": str(resolved_doc_path),
                    "module_id": module.get("module_id"),
                    "field": "module_id",
                }
            )

        if metadata["version"] != module.get("module_version"):
            metadata_errors.append(
                {
                    "code": "module_contract_mismatch",
                    "message": "module_version mismatch between registry and contract.",
                    "path": str(resolved_doc_path),
                    "module_id": module.get("module_id"),
                    "field": "version",
                }
            )

        if metadata["module_name"] != module.get("name"):
            metadata_errors.append(
                {
                    "code": "module_contract_mismatch",
                    "message": "module_name mismatch between registry and contract.",
                    "path": str(resolved_doc_path),
                    "module_id": module.get("module_id"),
                    "field": "module_name",
                }
            )

        if metadata_errors:
            result["rejected_modules"].append(module)
            result["validation_errors"].extend(metadata_errors)
            continue

        loaded_module = dict(module)
        loaded_module["contract_metadata"] = metadata
        loaded_module["resolved_doc_path"] = str(resolved_doc_path)
        result["loaded_modules"].append(loaded_module)

    return result