import copy
from typing import Any

REQUIRED_MODULE_FIELDS = (
    "module_id",
    "module_version",
    "name",
    "status",
    "category",
    "primary_entity",
    "technical_complexity",
    "doc_path",
)

ALLOWED_STATUSES = {"active", "inactive", "draft"}
ALLOWED_TECHNICAL_COMPLEXITY = {"low", "medium", "high"}


def validate_modules_registry(registry_data: Any) -> dict:
    result = {
        "registry_version": None,
        "valid_modules": [],
        "rejected_modules": [],
        "validation_errors": [],
    }

    if not isinstance(registry_data, dict):
        result["validation_errors"].append(
            {
                "code": "invalid_registry_type",
                "message": "Registry must be a JSON object.",
                "path": "registry",
            }
        )
        return result

    registry_version = registry_data.get("registry_version")
    result["registry_version"] = registry_version

    if not registry_version:
        result["validation_errors"].append(
            {
                "code": "missing_registry_version",
                "message": "registry_version is required.",
                "path": "registry_version",
            }
        )

    modules = registry_data.get("modules")
    if not isinstance(modules, list):
        result["validation_errors"].append(
            {
                "code": "invalid_modules",
                "message": "modules is required and must be a list.",
                "path": "modules",
            }
        )
        return result

    seen_module_ids: dict[str, int] = {}
    seen_doc_paths: dict[str, int] = {}

    for index, module in enumerate(modules):
        module_errors: list[dict[str, Any]] = []
        module_id = None

        if not isinstance(module, dict):
            module_errors.append(
                {
                    "code": "invalid_module_type",
                    "message": "Each module must be a JSON object.",
                    "path": f"modules[{index}]",
                }
            )
        else:
            module_id = module.get("module_id")
            for field_name in REQUIRED_MODULE_FIELDS:
                if not module.get(field_name):
                    module_errors.append(
                        {
                            "code": "missing_required_field",
                            "message": f"{field_name} is required.",
                            "path": f"modules[{index}].{field_name}",
                            "module_id": module_id,
                        }
                    )

            status = module.get("status")
            if status and status not in ALLOWED_STATUSES:
                module_errors.append(
                    {
                        "code": "invalid_status",
                        "message": f"status must be one of {sorted(ALLOWED_STATUSES)}.",
                        "path": f"modules[{index}].status",
                        "module_id": module_id,
                    }
                )

            technical_complexity = module.get("technical_complexity")
            if technical_complexity and technical_complexity not in ALLOWED_TECHNICAL_COMPLEXITY:
                module_errors.append(
                    {
                        "code": "invalid_technical_complexity",
                        "message": (
                            "technical_complexity must be one of "
                            f"{sorted(ALLOWED_TECHNICAL_COMPLEXITY)}."
                        ),
                        "path": f"modules[{index}].technical_complexity",
                        "module_id": module_id,
                    }
                )

            if module_id:
                if module_id in seen_module_ids:
                    module_errors.append(
                        {
                            "code": "duplicate_module_id",
                            "message": f"Duplicate module_id '{module_id}'.",
                            "path": f"modules[{index}].module_id",
                            "module_id": module_id,
                        }
                    )
                else:
                    seen_module_ids[module_id] = index

            doc_path = module.get("doc_path")
            if doc_path:
                if doc_path in seen_doc_paths:
                    module_errors.append(
                        {
                            "code": "duplicate_doc_path",
                            "message": f"Duplicate doc_path '{doc_path}'.",
                            "path": f"modules[{index}].doc_path",
                            "module_id": module_id,
                        }
                    )
                else:
                    seen_doc_paths[doc_path] = index

        if module_errors:
            result["rejected_modules"].append(copy.deepcopy(module))
            result["validation_errors"].extend(module_errors)
        else:
            result["valid_modules"].append(copy.deepcopy(module))

    return result
