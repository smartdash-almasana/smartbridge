# app/interpretation/engine.py
from __future__ import annotations

from app.interpretation.evaluator import collect_evidence_gaps, evaluate_pathologies
from app.interpretation.renderer import render_output
from app.interpretation.types import InterpretationBundle, InterpretationOutput


def interpret(bundle: InterpretationBundle) -> InterpretationOutput:
    """
    Entry point: evaluate all pathologies against the bundle's facts
    and produce a V2-compliant InterpretationOutput.
    """
    active_pathologies = evaluate_pathologies(bundle)
    evidence_gaps = collect_evidence_gaps(bundle)
    return render_output(
        tenant_id=bundle.tenant_id,
        period=bundle.period,
        active_pathologies=active_pathologies,
        evidence_gaps=evidence_gaps,
    )
