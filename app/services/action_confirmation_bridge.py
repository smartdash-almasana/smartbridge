"""Bridge confirmed drafts into the existing action_engine execution flow."""
from __future__ import annotations

from typing import Any

from app.services.audit_trail import log_job_event
from app.services.action_engine.from_signals import execute_action_from_signal


_DRAFT_TYPE_TO_SIGNAL_CODE: dict[str, str] = {
    "review_discrepancy": "order_mismatch",
    "request_information": "order_missing_in_documents",
    "review_finding": "order_mismatch",
}


def draft_to_action_payload(draft: dict[str, Any]) -> dict[str, str]:
    """Map a draft deterministically to the action_engine signal payload."""
    draft_type = str(draft.get("draft_type", "")).strip()
    signal_code = _DRAFT_TYPE_TO_SIGNAL_CODE.get(draft_type)
    if signal_code is None:
        raise ValueError(f"Unsupported draft_type: {draft_type}")

    entity_ref = draft.get("entity_ref")
    if not isinstance(entity_ref, str) or not entity_ref.strip():
        raise ValueError("Draft must include a non-empty 'entity_ref'.")

    return {
        "signal_code": signal_code,
        "entity_ref": entity_ref.strip(),
    }


def execute_if_confirmed(draft: dict[str, Any], tenant_id: str) -> dict[str, str]:
    """Execute through action_engine only when draft state is confirmed."""
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise ValueError("'tenant_id' must be a non-empty string.")

    state = str(draft.get("state", "")).strip()
    if state != "confirmed":
        raise ValueError(f"Draft state '{state}' is not executable. Expected 'confirmed'.")

    payload = draft_to_action_payload(draft)
    result = execute_action_from_signal(payload)
    try:
        job_id = str(draft.get("job_id", "unknown_job")).strip() or "unknown_job"
        log_job_event(
            job_id=job_id,
            event_type="action_executed",
            payload={
                "tenant_id": tenant_id.strip(),
                "signal_code": payload["signal_code"],
                "entity_ref": payload["entity_ref"],
                "status": result.get("status"),
            },
        )
    except Exception:
        # Audit must never break controlled execution flow.
        pass
    return result
