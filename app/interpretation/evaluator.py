# app/interpretation/evaluator.py
from typing import Any, Dict, Iterable
from .pathology_catalog import PATHOLOGIES
from .types import (
    ActivePathology,
    TriggerCondition,
    PathologySpec,
    EconomicFacts,
    DiagnosticUnit,
    EvaluationStatus,
    DiagnosticTargetRef,
    ConfidenceRule,
    DiagnosticTargetType,
    EvidenceGap,
)


class ConditionEvaluationError(Exception):
    pass


def _resolve(data: Dict[str, Any], field: str) -> Any:
    return data.get(field)


def evaluate_trigger(condition: TriggerCondition, facts: Dict[str, Any]) -> bool:
    val = _resolve(facts, condition.field)
    op = condition.op

    if op == "present":
        return val is not None
    if op == "absent":
        return val is None
    if op == "truthy":
        return bool(val)

    if val is None:
        return False

    try:
        if op == "gt":
            return val > condition.value
        if op == "lt":
            return val < condition.value
        if op == "gte":
            return val >= condition.value
        if op == "lte":
            return val <= condition.value
        if op == "ratio_gt":
            ref = _resolve(facts, condition.ref_field)
            if ref is None or ref == 0:
                return False
            return (val / ref) > condition.value
    except TypeError:
        return False

    raise ConditionEvaluationError(f"Unknown operator: {op}")


def _build_target_ref(spec: PathologySpec, facts: EconomicFacts) -> DiagnosticTargetRef:
    data = facts.data

    if spec.target_type == DiagnosticTargetType.CHANNEL:
        channel_name = data.get("channel_name")
        if channel_name:
            return DiagnosticTargetRef(identifier=str(channel_name), name=str(channel_name))

    if spec.target_type == DiagnosticTargetType.BUSINESS:
        business_name = data.get("business_name")
        if business_name:
            return DiagnosticTargetRef(identifier=str(business_name), name=str(business_name))
        return DiagnosticTargetRef(identifier=facts.tenant_id, name=facts.tenant_id)

    return DiagnosticTargetRef()


def evaluate_pathology(spec: PathologySpec, facts: EconomicFacts) -> DiagnosticUnit:
    data = facts.data
    gaps = [ev for ev in spec.expected_evidence if _resolve(data, ev.missing_field) is None]
    blocking_gaps = [g for g in gaps if g.blocks_evaluation]

    if blocking_gaps:
        return DiagnosticUnit(
            pathology_id=spec.pathology_id,
            status=EvaluationStatus.NOT_EVALUABLE,
            kind=spec.kind,
            diagnostic_scope=spec.diagnostic_scope,
            impact_class=spec.impact_class,
            target_type=spec.target_type,
            target_ref=_build_target_ref(spec, facts),
            confidence=0.0,
            evidence_gaps=blocking_gaps,
            facts_snapshot={},
        )

    triggers_met = all(evaluate_trigger(t, data) for t in spec.triggers)

    if not triggers_met:
        return DiagnosticUnit(
            pathology_id=spec.pathology_id,
            status=EvaluationStatus.NOT_MATCHED,
            kind=spec.kind,
            diagnostic_scope=spec.diagnostic_scope,
            impact_class=spec.impact_class,
            target_type=spec.target_type,
            target_ref=_build_target_ref(spec, facts),
            confidence=0.0,
            evidence_gaps=[],
            facts_snapshot={},
        )

    if spec.confidence_rule == ConfidenceRule.STRICT:
        confidence = 0.0 if gaps else 1.0
    else:
        total = len(spec.expected_evidence)
        present = total - len(gaps)
        confidence = present / total if total > 0 else 1.0

    relevant_fields = {t.field for t in spec.triggers} | {e.missing_field for e in spec.expected_evidence}

    return DiagnosticUnit(
        pathology_id=spec.pathology_id,
        status=EvaluationStatus.MATCHED,
        kind=spec.kind,
        diagnostic_scope=spec.diagnostic_scope,
        impact_class=spec.impact_class,
        target_type=spec.target_type,
        target_ref=_build_target_ref(spec, facts),
        confidence=confidence,
        evidence_gaps=gaps,
        facts_snapshot={k: v for k, v in data.items() if k in relevant_fields},
    )


def _extract_facts(input_obj: Any) -> EconomicFacts:
    if isinstance(input_obj, EconomicFacts):
        return input_obj
    if hasattr(input_obj, "facts") and isinstance(input_obj.facts, EconomicFacts):
        return input_obj.facts
    raise TypeError("Expected EconomicFacts or bundle with EconomicFacts in .facts")


def evaluate_pathologies(
    input_obj: Any,
    catalog: Iterable[PathologySpec] | None = None,
) -> tuple[ActivePathology, ...]:
    facts = _extract_facts(input_obj)
    specs = tuple(catalog) if catalog is not None else tuple(PATHOLOGIES)
    active: list[ActivePathology] = []

    for spec in specs:
        unit = evaluate_pathology(spec, facts)
        if unit.status != EvaluationStatus.MATCHED:
            continue
        active.append(
            ActivePathology(
                pathology_id=spec.pathology_id,
                name=spec.name,
                description=spec.description,
                kind=spec.kind,
                diagnostic_scope=spec.diagnostic_scope,
                impact_class=spec.impact_class,
                target_type=spec.target_type,
                target_ref=unit.target_ref,
                confidence=unit.confidence,
                evidence_gaps=unit.evidence_gaps,
            )
        )

    return tuple(active)


def collect_evidence_gaps(
    input_obj: Any,
    catalog: Iterable[PathologySpec] | None = None,
) -> tuple[EvidenceGap, ...]:
    facts = _extract_facts(input_obj)
    specs = tuple(catalog) if catalog is not None else tuple(PATHOLOGIES)
    data = facts.data
    gaps: list[EvidenceGap] = []

    for spec in specs:
        for ev in spec.expected_evidence:
            if ev.missing_field not in data:
                gaps.append(ev)

    return tuple(gaps)
