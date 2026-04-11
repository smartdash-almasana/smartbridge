"""
services/action_engine/dispatcher.py
--------------------------------------
Executes pending action jobs and returns updated action objects.

Guarantees:
  - Deterministic: no randomness, no timestamps, no shared state.
  - No mutations: input list and dicts are never modified.
  - No side effects: no I/O, no logging.
  - Fail-fast: invalid input raises ValueError immediately.
"""

from typing import Any

Action = dict[str, Any]
ExecutionResult = dict[str, Any]

# Set of action types that the dispatcher is authorised to execute.
# Raise ValueError for anything outside this set.
VALID_ACTION_TYPES: frozenset[str] = frozenset({
    "review_order",
    "request_document",
    "check_event_flow",
})

# Only actions in this status are eligible for execution.
_PENDING_STATUS: str = "pending"
_COMPLETED_STATUS: str = "completed"


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_actions_input(actions: list[Action]) -> None:
    """
    Validate the top-level input before processing any item.
    Raises ValueError on the first structural problem found.
    """
    if not isinstance(actions, list):
        raise ValueError(
            f"'actions' must be a list, got {type(actions).__name__}."
        )


def _validate_action(action: Action) -> None:
    """
    Validate a single action dict.
    Raises ValueError on the first violation.
    """
    if not isinstance(action, dict):
        raise ValueError(
            f"Each action must be a dict, got {type(action).__name__}."
        )

    action_id = action.get("action_id")
    if not isinstance(action_id, str) or not action_id.strip():
        raise ValueError(
            f"Action is missing a valid 'action_id': {action!r}"
        )

    action_type = action.get("action_type")
    if not isinstance(action_type, str) or not action_type.strip():
        raise ValueError(
            f"Action '{action_id}' is missing a valid 'action_type'."
        )
    if action_type not in VALID_ACTION_TYPES:
        raise ValueError(
            f"Action '{action_id}' has an invalid action_type '{action_type}'. "
            f"Valid types: {sorted(VALID_ACTION_TYPES)}."
        )


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def _execute_action(action: Action) -> ExecutionResult:
    """
    Execute a single pending action and return its execution outcome.

    This is the integration boundary where real side-effectful calls would
    live in a future implementation (e.g. HTTP, queue, RPC). For now it is
    a pure, deterministic stub that always succeeds.

    Returns:
        {
            "status": "completed",
            "result": {
                "message": "Executed <action_type> for <entity_ref>",
                "success": True,
            }
        }
    """
    action_type = action["action_type"]
    entity_ref = action.get("entity_ref", "unknown")

    return {
        "status": _COMPLETED_STATUS,
        "result": {
            "message": f"Executed {action_type} for {entity_ref}",
            "success": True,
        },
    }


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def dispatch_actions(actions: list[Action]) -> list[Action]:
    """
    Execute all pending action jobs and return updated action objects.

    Processing rules:
      - status == "pending" → execute via _execute_action, mark as "completed".
      - status != "pending" → return unchanged (idempotent).
      - Invalid action_type  → raises ValueError immediately (fail-fast).

    Args:
        actions:
            List of action job dicts as produced by build_action_jobs_from_signals.
            Must be a list; each element must be a dict with 'action_id' and
            a valid 'action_type'.

    Returns:
        A new list of action dicts in the same order as the input.
        Each dict is a new object — inputs are never mutated.
        Pending actions gain two new keys: "status" and "execution_result".

    Raises:
        ValueError:
            - 'actions' is not a list.
            - Any action is not a dict or is missing 'action_id'.
            - Any action carries an action_type not in VALID_ACTION_TYPES.
    """
    _validate_actions_input(actions)

    # Validate all actions up front (fail-fast before executing any).
    for action in actions:
        _validate_action(action)

    dispatched: list[Action] = []

    for action in actions:
        if action.get("status") != _PENDING_STATUS:
            # Non-pending actions pass through unchanged (new dict, no mutation).
            dispatched.append(dict(action))
            continue

        execution = _execute_action(action)

        updated: Action = {
            **action,
            "status": execution["status"],
            "execution_result": execution["result"],
        }
        dispatched.append(updated)

    return dispatched
