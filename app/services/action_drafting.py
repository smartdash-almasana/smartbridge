"""Minimal, side-effect-free action drafting from findings."""
from __future__ import annotations

from typing import Any

from app.services.audit_trail import log_job_event


def _extract_entity_ref(finding: dict[str, Any]) -> str:
    entity_ref = finding.get("entity_ref")
    if isinstance(entity_ref, str) and entity_ref.strip():
        return entity_ref.strip()

    entity_name = finding.get("entity_name")
    if isinstance(entity_name, str) and entity_name.strip():
        return entity_name.strip()

    metadata = finding.get("metadata")
    if isinstance(metadata, dict):
        order_id = metadata.get("order_id")
        if isinstance(order_id, str) and order_id.strip():
            return order_id.strip()

    return "unknown_entity"


def _resolve_draft_type(finding: dict[str, Any]) -> str:
    finding_type = str(finding.get("type", "")).strip().lower()
    if "missing" in finding_type:
        return "request_information"
    if "mismatch" in finding_type:
        return "review_discrepancy"
    return "review_finding"


def _build_summary(finding: dict[str, Any], entity_ref: str) -> str:
    finding_type = str(finding.get("type", "issue")).strip() or "issue"
    return f"Revisar {finding_type} en {entity_ref}."


def _build_proposed_action(draft_type: str) -> str:
    if draft_type == "request_information":
        return "Solicitar informacion faltante para validar el caso."
    if draft_type == "review_discrepancy":
        return "Validar la diferencia y confirmar el siguiente paso."
    return "Revisar el hallazgo y definir accion recomendada."


def finding_to_action_draft(finding: dict[str, Any]) -> dict[str, Any]:
    """Build one deterministic action draft from one finding."""
    entity_ref = _extract_entity_ref(finding)
    draft_type = _resolve_draft_type(finding)
    source_finding_id = finding.get("finding_id")
    if not isinstance(source_finding_id, str) or not source_finding_id.strip():
        source_finding_id = "unknown_finding"

    draft = {
        "draft_type": draft_type,
        "entity_ref": entity_ref,
        "summary": _build_summary(finding, entity_ref),
        "proposed_action": _build_proposed_action(draft_type),
        "requires_confirmation": True,
        "source_finding_id": source_finding_id,
    }
    try:
        job_id = str(finding.get("job_id", "unknown_job")).strip() or "unknown_job"
        log_job_event(
            job_id=job_id,
            event_type="draft_created",
            payload={
                "source_finding_id": source_finding_id,
                "draft_type": draft_type,
                "entity_ref": entity_ref,
            },
        )
    except Exception:
        # Audit must never break drafting flow.
        pass
    return draft


def findings_to_action_drafts(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build one draft per finding with no side effects."""
    if not findings:
        return []
    return [finding_to_action_draft(finding) for finding in findings]
