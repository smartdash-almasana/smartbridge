"""Minimal confirmation state transitions for action drafts."""
from __future__ import annotations

from typing import Any

from app.services.audit_trail import log_job_event


_VALID_STATES = {"draft", "pending_confirmation", "confirmed", "cancelled"}


def _read_state(draft: dict[str, Any]) -> str:
    state = draft.get("state", "draft")
    if not isinstance(state, str):
        raise ValueError("Draft state must be a string.")
    state_clean = state.strip()
    if state_clean not in _VALID_STATES:
        raise ValueError(f"Invalid draft state: {state_clean}")
    return state_clean


def _transition(draft: dict[str, Any], expected_from: str, to_state: str) -> dict[str, Any]:
    current = _read_state(draft)
    if current != expected_from:
        raise ValueError(f"Invalid transition: {current} -> {to_state}")
    return {**draft, "state": to_state}


def mark_draft_pending_confirmation(draft: dict[str, Any]) -> dict[str, Any]:
    """Transition draft -> pending_confirmation."""
    return _transition(draft, expected_from="draft", to_state="pending_confirmation")


def mark_draft_confirmed(draft: dict[str, Any]) -> dict[str, Any]:
    """Transition pending_confirmation -> confirmed."""
    updated = _transition(draft, expected_from="pending_confirmation", to_state="confirmed")
    try:
        job_id = str(updated.get("job_id", "unknown_job")).strip() or "unknown_job"
        log_job_event(
            job_id=job_id,
            event_type="draft_confirmed",
            payload={
                "source_finding_id": updated.get("source_finding_id"),
                "entity_ref": updated.get("entity_ref"),
            },
        )
    except Exception:
        # Audit must never break confirmation flow.
        pass
    return updated


def mark_draft_cancelled(draft: dict[str, Any]) -> dict[str, Any]:
    """Transition pending_confirmation -> cancelled."""
    return _transition(draft, expected_from="pending_confirmation", to_state="cancelled")
