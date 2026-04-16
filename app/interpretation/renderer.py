# app/interpretation/renderer.py
from __future__ import annotations

from app.interpretation.types import (
    ActivePathology,
    EvidenceGap,
    ImpactClass,
    InterpretationKind,
    InterpretationOutput,
)


def render_output(
    tenant_id: str,
    period: str,
    active_pathologies: tuple[ActivePathology, ...],
    evidence_gaps: tuple[EvidenceGap, ...] = (),
) -> InterpretationOutput:
    """
    Produce the V2 InterpretationOutput from a list of active pathologies.

    Separates pathologies by kind and impact_class.
    Produces executive_summary and key_questions without accessing
    fields that no longer exist on ActivePathology (questions, blockers, levers, score).
    """
    profitability_risk = [
        p for p in active_pathologies
        if p.impact_class == ImpactClass.HIGH
        and p.kind == InterpretationKind.PATHOLOGY
    ]
    growth_blockers = [
        p for p in active_pathologies
        if p.kind == InterpretationKind.BLOCKER
    ]
    growth_levers = [
        p for p in active_pathologies
        if p.kind == InterpretationKind.LEVER
    ]
    data_blindness = [
        p for p in active_pathologies
        if p.kind == InterpretationKind.PATHOLOGY
        and p.impact_class != ImpactClass.HIGH
    ]

    if active_pathologies:
        top = active_pathologies[0]
        executive_summary = (
            f"{len(active_pathologies)} patologia(s) activa(s). "
            f"Prioridad: {top.name} [{top.impact_class.value}]. "
            f"Alcance: {top.diagnostic_scope.value}."
        )
        key_questions = [
            f"¿Cuál es el impacto real de {p.name} en este período?"
            for p in active_pathologies[:3]
        ]
        if evidence_gaps:
            key_questions.insert(0, f"¿Podemos relevar {evidence_gaps[0].missing_field}?")
    else:
        executive_summary = (
            "No se detectan patologías activas con la evidencia disponible."
        )
        if evidence_gaps:
            key_questions = [f"¿Podemos relevar {evidence_gaps[0].missing_field}?"]
        else:
            key_questions = [
                "¿Qué variable financiera querés priorizar para la siguiente lectura?"
            ]

    return InterpretationOutput(
        tenant_id=tenant_id,
        period=period,
        pathologies=list(active_pathologies),
        profitability_risk=profitability_risk,
        growth_blockers=growth_blockers,
        growth_levers=growth_levers,
        data_blindness=data_blindness,
        executive_summary=executive_summary,
        key_questions=key_questions,
    )
