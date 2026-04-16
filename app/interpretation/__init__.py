from app.interpretation.engine import interpret
from app.interpretation.pathology_catalog import PATHOLOGIES
from app.interpretation.renderer import render_output
from app.interpretation.types import (
    ActivePathology,
    ConfidenceRule,
    DiagnosticScope,
    DiagnosticTargetRef,
    DiagnosticTargetType,
    DiagnosticUnit,
    EvidenceGap,
    EvaluationStatus,
    GapReason,
    ImpactClass,
    InterpretationBundle,
    InterpretationKind,
    InterpretationOutput,
    EconomicFacts,
    PathologySpec,
    TriggerCondition,
)

__all__ = [
    # Catalog
    "PATHOLOGIES",
    # Entry points
    "interpret",
    "render_output",
    # Bundle + Output
    "InterpretationBundle",
    "InterpretationOutput",
    "EconomicFacts",
    # Enums
    "ConfidenceRule",
    "DiagnosticScope",
    "DiagnosticTargetType",
    "EvaluationStatus",
    "GapReason",
    "ImpactClass",
    "InterpretationKind",
    # Data contracts
    "ActivePathology",
    "DiagnosticTargetRef",
    "DiagnosticUnit",
    "EvidenceGap",
    "PathologySpec",
    "TriggerCondition",
]
