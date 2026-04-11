"""
services/action_engine/from_signals.py
---------------------------------------
Generates deterministic action jobs from OPEN signals.

Only signals with status="open" produce actions.
Persisting and resolved signals are intentionally ignored.

Guarantees:
  - Deterministic: same lifecycle + tenant_id → identical output.
  - No mutations: inputs are never modified.
  - No side effects: no I/O, logging, or shared state.
  - No real timestamps: created_at is fixed sentinel value.
"""

import hashlib
import json
from typing import Any

ActionJob = dict[str, Any]

# Fixed sentinel timestamp — no real wall-clock time is used.
CREATED_AT_SENTINEL: str = "1970-01-01T00:00:00+00:00"

# Maps signal_code → action_type.
# Raise ValueError for any signal_code not present here.
SIGNAL_CODE_TO_ACTION_TYPE: dict[str, str] = {
    "order_mismatch": "review_order",
    "order_missing_in_documents": "request_document",
    "order_missing_in_events": "check_event_flow",
}

# Required fields that every open signal must carry.
_REQUIRED_SIGNAL_FIELDS: tuple[str, ...] = (
    "global_signal_id",
    "signal_code",
    "entity_ref",
    "source_module",
    "priority_score",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_action_type(signal_code: str) -> str:
    """
    Resolve the action type for a given signal_code.
    Raises ValueError for unmapped codes.
    """
    action_type = SIGNAL_CODE_TO_ACTION_TYPE.get(signal_code)
    if action_type is None:
        raise ValueError(
            f"No action mapping found for signal_code '{signal_code}'. "
            f"Known codes: {sorted(SIGNAL_CODE_TO_ACTION_TYPE.keys())}."
        )
    return action_type


def _build_action_id(global_signal_id: str, action_type: str) -> str:
    """
    Build a deterministic action ID from global_signal_id + action_type.

    Format: "act_<sha256_hex[:24]>"

    Using both fields ensures that if the same signal ever maps to
    multiple action types in the future, each gets a distinct action_id.
    """
    canonical = json.dumps(
        {"action_type": action_type, "global_signal_id": global_signal_id},
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"act_{digest[:24]}"


def _validate_open_signal(signal: dict[str, Any]) -> None:
    """
    Validate that an open signal carries all required fields with correct types.
    Raises ValueError on the first violation found.
    """
    for field in _REQUIRED_SIGNAL_FIELDS:
        if field not in signal:
            raise ValueError(
                f"Open signal is missing required field '{field}': {signal!r}"
            )

    if not isinstance(signal["global_signal_id"], str) or not signal["global_signal_id"].strip():
        raise ValueError("Field 'global_signal_id' must be a non-empty string.")

    if not isinstance(signal["signal_code"], str) or not signal["signal_code"].strip():
        raise ValueError("Field 'signal_code' must be a non-empty string.")

    if not isinstance(signal["entity_ref"], str) or not signal["entity_ref"].strip():
        raise ValueError("Field 'entity_ref' must be a non-empty string.")

    if not isinstance(signal["source_module"], str) or not signal["source_module"].strip():
        raise ValueError("Field 'source_module' must be a non-empty string.")

    if not isinstance(signal["priority_score"], int):
        raise ValueError(
            f"Field 'priority_score' must be an int, "
            f"got {type(signal['priority_score']).__name__}."
        )


def _build_action_job(signal: dict[str, Any], tenant_id: str) -> ActionJob:
    """
    Build a single action job dict from an open signal.
    Returns a new dict — the original signal is never mutated.
    """
    signal_code = signal["signal_code"].strip()
    entity_ref = signal["entity_ref"].strip()
    global_signal_id = signal["global_signal_id"].strip()
    source_module = signal["source_module"].strip()

    action_type = _resolve_action_type(signal_code)
    action_id = _build_action_id(global_signal_id, action_type)

    return {
        "action_id": action_id,
        "tenant_id": tenant_id,
        "global_signal_id": global_signal_id,
        "signal_code": signal_code,
        "entity_ref": entity_ref,
        "action_type": action_type,
        "priority_score": signal["priority_score"],
        "status": "pending",
        "created_at": CREATED_AT_SENTINEL,
        "context": {
            "signal_code": signal_code,
            "entity_ref": entity_ref,
            "source_module": source_module,
        },
    }


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def build_action_jobs_from_signals(
    lifecycle: dict[str, Any],
    tenant_id: str,
) -> list[ActionJob]:
    """
    Generate deterministic action jobs from the OPEN signals in a lifecycle dict.

    Only lifecycle["lifecycle"]["open"] signals produce actions.
    Persisting and resolved signals are intentionally ignored.

    Args:
        lifecycle:
            Output of compute_signal_lifecycle(). Must contain a
            "lifecycle" key with an "open" list.
        tenant_id:
            Non-empty string identifying the tenant for which actions are
            generated.

    Returns:
        A list of action job dicts, one per open signal, sorted
        deterministically by (priority_score DESC, action_id ASC).
        Returns [] when there are no open signals.

    Raises:
        ValueError:
            - tenant_id is missing or empty.
            - lifecycle["lifecycle"]["open"] is absent or not a list.
            - Any open signal is missing required fields.
            - Any open signal carries an unknown signal_code.
    """
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("'tenant_id' must be a non-empty string.")

    tenant_id_clean = tenant_id.strip()

    lifecycle_data = lifecycle.get("lifecycle")
    if not isinstance(lifecycle_data, dict):
        raise ValueError(
            "Input 'lifecycle' must contain a 'lifecycle' dict key."
        )

    open_signals = lifecycle_data.get("open")
    if not isinstance(open_signals, list):
        raise ValueError(
            "lifecycle['lifecycle']['open'] must be a list."
        )

    if not open_signals:
        return []

    action_jobs: list[ActionJob] = []

    for signal in open_signals:
        if not isinstance(signal, dict):
            raise ValueError(
                f"Each open signal must be a dict, got {type(signal).__name__}."
            )
        _validate_open_signal(signal)
        action_jobs.append(_build_action_job(signal, tenant_id_clean))

    # Deterministic sort: highest priority first, then stable by action_id.
    action_jobs.sort(
        key=lambda job: (-job["priority_score"], job["action_id"])
    )

    return action_jobs
