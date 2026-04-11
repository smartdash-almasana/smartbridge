"""
services/ingestion/service.py
-----------------------------
Filesystem-based ingestion persistence for module payload artifacts.
"""

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CONTRACT_VERSION: str = "module-ingestion.v1"

REQUIRED_FIELD_SPECS: dict[str, type] = {
    "tenant_id": str,
    "module": str,
    "generated_at": str,
    "canonical_rows": list,
    "findings": list,
    "summary": dict,
    "suggested_actions": list,
}

# Non-empty string fields (subset of REQUIRED_FIELD_SPECS).
NON_EMPTY_STR_FIELDS: frozenset[str] = frozenset({"tenant_id", "module"})

# Fields excluded from hash computation because they are volatile and change
# on every call even for identical business data (e.g. generated_at changes
# per request). Excluding them guarantees the same hash for the same business
# payload regardless of when it was submitted — enabling idempotent ingestion.
HASH_EXCLUDE_FIELDS: frozenset[str] = frozenset({"generated_at"})


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate_payload(payload: dict[str, Any]) -> None:
    """
    Validate the module payload against the ingestion contract.

    Raises ValueError with a precise field name on any violation.
    """
    for field, expected_type in REQUIRED_FIELD_SPECS.items():
        if field not in payload:
            raise ValueError(
                f"Payload is missing required field: '{field}'."
            )

        value = payload[field]

        if not isinstance(value, expected_type):
            raise ValueError(
                f"Field '{field}' must be of type {expected_type.__name__}, "
                f"got {type(value).__name__}."
            )

        if field in NON_EMPTY_STR_FIELDS and not value.strip():
            raise ValueError(
                f"Field '{field}' must be a non-empty string."
            )


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

def _sort_for_hash(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Return a shallow copy of payload with list fields sorted by stable keys.

    Sorting rules (applied only for hash computation — original never mutated):
      - canonical_rows : sorted by (event.order_id, document.order_id).
                         Falls back to empty string when a key is absent.
      - findings       : sorted by finding_id.
      - suggested_actions: sorted by action_type.

    Any list field not listed above is left in its original order.
    Any item that is not a dict is sorted by its repr() for stability.
    """
    def _safe_str(mapping: Any, *keys: str) -> str:
        """Extract nested string keys with a safe fallback."""
        if not isinstance(mapping, dict):
            return repr(mapping)
        for key in keys:
            val = mapping.get(key)
            if val is not None:
                return str(val)
        return ""

    result = {k: v for k, v in payload.items()}

    if "canonical_rows" in result and isinstance(result["canonical_rows"], list):
        result["canonical_rows"] = sorted(
            result["canonical_rows"],
            key=lambda row: (
                _safe_str(row.get("event") if isinstance(row, dict) else None, "order_id"),
                _safe_str(row.get("document") if isinstance(row, dict) else None, "order_id"),
            ),
        )

    if "findings" in result and isinstance(result["findings"], list):
        result["findings"] = sorted(
            result["findings"],
            key=lambda f: _safe_str(f, "finding_id"),
        )

    if "suggested_actions" in result and isinstance(result["suggested_actions"], list):
        result["suggested_actions"] = sorted(
            result["suggested_actions"],
            key=lambda a: _safe_str(a, "action_type"),
        )

    return result


def _compute_content_hash(payload: dict[str, Any]) -> str:
    """
    Compute a deterministic SHA-256 hash of the payload's stable business data.

    Two guarantees:
      1. Volatile fields (HASH_EXCLUDE_FIELDS, e.g. generated_at) are stripped
         so that identical business data submitted at different times produces
         the same hash — enabling idempotent ingestion_ids.
      2. List fields are sorted by stable domain keys (see _sort_for_hash) so
         that semantically identical payloads with different list ordering also
         produce the same hash.

    The original payload dict is never mutated.
    Keys are sorted before serialization for key-order independence.
    """
    # Strip volatile fields first.
    stable = {k: v for k, v in payload.items() if k not in HASH_EXCLUDE_FIELDS}
    # Sort list fields by stable domain keys (copy only, no mutation).
    sortable = _sort_for_hash(stable)
    canonical = json.dumps(sortable, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _build_ingestion_id(content_hash: str) -> str:
    """Build ingestion ID from the full content hash."""
    return f"ing_{content_hash}"


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------

def _write_json(path: Path, data: Any) -> None:
    """Write data as indented JSON to path (UTF-8)."""
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def _persist_artifacts(
    final_path: Path,
    payload: dict[str, Any],
    enriched: dict[str, Any],
) -> None:
    """
    Persist payload artifacts into an already-created ingestion directory.

    input.json receives the enriched payload (includes contract_version and
    content_hash for full traceability). All other artifact files are written
    from the original payload fields.
    """
    _write_json(final_path / "input.json", enriched)
    _write_json(final_path / "canonical_rows.json", payload["canonical_rows"])
    _write_json(final_path / "findings.json", payload["findings"])
    _write_json(final_path / "summary.json", payload["summary"])
    _write_json(final_path / "suggested_actions.json", payload["suggested_actions"])


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def persist_module_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Validate and persist a module payload to structured filesystem artifacts.

    Storage layout:
        data/<tenant_id>/<module>/<ingestion_id>/
    """
    _validate_payload(payload)

    tenant_id: str = payload["tenant_id"].strip()
    module: str = payload["module"].strip()

    content_hash = _compute_content_hash(payload)
    ingestion_id = _build_ingestion_id(content_hash)

    base_dir = Path("data") / tenant_id / module
    final_path = base_dir / ingestion_id

    if final_path.exists():
        logger.info(
            "Ingestion deduplicated: tenant='%s', module='%s', ingestion_id='%s'.",
            tenant_id,
            module,
            ingestion_id,
        )
        return {
            "ok": True,
            "ingestion_id": ingestion_id,
            "content_hash": content_hash,
            "contract_version": CONTRACT_VERSION,
            "module": module,
            "tenant_id": tenant_id,
            "path": str(final_path.resolve()),
            "status": "deduplicated",
        }

    # Build enriched payload — never mutate the caller's dict.
    enriched: dict[str, Any] = {
        **payload,
        "contract_version": CONTRACT_VERSION,
        "content_hash": content_hash,
    }

    base_dir.mkdir(parents=True, exist_ok=True)
    final_path.mkdir(parents=False, exist_ok=False)
    _persist_artifacts(final_path, payload, enriched)

    logger.info(
        "Ingestion created: tenant='%s', module='%s', ingestion_id='%s'.",
        tenant_id,
        module,
        ingestion_id,
    )

    return {
        "ok": True,
        "ingestion_id": ingestion_id,
        "content_hash": content_hash,
        "contract_version": CONTRACT_VERSION,
        "module": module,
        "tenant_id": tenant_id,
        "path": str(final_path.resolve()),
        "status": "accepted",
    }

