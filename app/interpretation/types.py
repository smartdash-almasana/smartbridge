# app/interpretation/types.py
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from enum import Enum


class DiagnosticScope(str, Enum):
    STRATEGIC = "strategic"
    OPERATIONAL = "operational"
    FINANCIAL = "financial"
    DATA_QUALITY = "data_quality"


class ImpactClass(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class InterpretationKind(str, Enum):
    PATHOLOGY = "pathology"
    BLOCKER = "blocker"
    LEVER = "lever"


class ConfidenceRule(str, Enum):
    STRICT = "strict"
    EVIDENCE_BASED = "evidence_based"


class DiagnosticTargetType(str, Enum):
    BUSINESS = "business"
    SKU = "sku"
    CHANNEL = "channel"
    CLIENT = "client"
    PRODUCT_LINE = "product_line"


class EvaluationStatus(str, Enum):
    MATCHED = "matched"
    NOT_MATCHED = "not_matched"
    NOT_EVALUABLE = "not_evaluable"


class GapReason(str, Enum):
    MISSING_DATA = "missing_data"
    THRESHOLD_NOT_MET = "threshold_not_met"
    LOGIC_DEPENDENT = "logic_dependent"


@dataclass
class TriggerCondition:
    field: str
    op: str
    value: Optional[float] = None
    ref_field: Optional[str] = None


@dataclass
class EvidenceGap:
    pathology_id: str
    missing_field: str
    blocks_evaluation: bool
    expected_type: str
    reason: GapReason


@dataclass
class DiagnosticTargetRef:
    identifier: Optional[str] = None
    name: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PathologySpec:
    pathology_id: str
    name: str
    description: str
    kind: InterpretationKind
    diagnostic_scope: DiagnosticScope
    impact_class: ImpactClass
    target_type: DiagnosticTargetType
    triggers: List[TriggerCondition]
    expected_evidence: List[EvidenceGap]
    confidence_rule: ConfidenceRule = ConfidenceRule.EVIDENCE_BASED


@dataclass
class EconomicFacts:
    tenant_id: str
    period: str
    data: Dict[str, Any]


@dataclass
class DiagnosticUnit:
    pathology_id: str
    status: EvaluationStatus
    kind: InterpretationKind
    diagnostic_scope: DiagnosticScope
    impact_class: ImpactClass
    target_type: DiagnosticTargetType
    target_ref: DiagnosticTargetRef
    confidence: float
    evidence_gaps: List[EvidenceGap] = field(default_factory=list)
    facts_snapshot: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActivePathology:
    pathology_id: str
    name: str
    description: str
    kind: InterpretationKind
    diagnostic_scope: DiagnosticScope
    impact_class: ImpactClass
    target_type: DiagnosticTargetType
    target_ref: DiagnosticTargetRef
    confidence: float
    evidence_gaps: List[EvidenceGap] = field(default_factory=list)


@dataclass
class InterpretationOutput:
    tenant_id: str
    period: str
    pathologies: List[ActivePathology]
    profitability_risk: List[ActivePathology]
    growth_blockers: List[ActivePathology]
    growth_levers: List[ActivePathology]
    data_blindness: List[ActivePathology]
    executive_summary: str
    key_questions: List[str]


@dataclass
class InterpretationBundle:
    tenant_id: str
    period: str
    facts: EconomicFacts