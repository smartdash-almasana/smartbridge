# tests/unit/test_interpretation_engine.py
import pytest

from app.interpretation.types import (
    EconomicFacts,
    EvaluationStatus,
    InterpretationBundle,
    InterpretationKind,
    InterpretationOutput,
    TriggerCondition,
)
from app.interpretation.evaluator import collect_evidence_gaps, evaluate_pathology, evaluate_trigger
from app.interpretation.pathology_catalog import PATHOLOGIES
from app.interpretation.engine import interpret
import app.interpretation as interpretation_pkg


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def heavy_facts():
    return EconomicFacts(
        tenant_id="t_001",
        period="2023-Q4",
        data={
            "revenue": 150_000,
            "gross_margin": -2_000,
            "inventory_days": 200,
            "inventory_turnover": 0.3,
            "channel_margin": -500,
            "channel_revenue_share": 0.25,
            "channel_name": "Channel_1",
            "inflation_rate": 0.12,
        },
    )


@pytest.fixture
def minimal_bundle(heavy_facts):
    return InterpretationBundle(
        tenant_id=heavy_facts.tenant_id,
        period=heavy_facts.period,
        facts=heavy_facts,
    )


# ── Package surface ───────────────────────────────────────────────────────────

class TestImportsAndTypes:
    def test_real_package_import(self):
        assert interpretation_pkg is not None

    def test_interpret_exported(self):
        assert callable(interpretation_pkg.interpret)

    def test_interpretation_bundle_available(self):
        from app.interpretation import InterpretationBundle
        assert InterpretationBundle is not None

    def test_economic_facts_buildable(self):
        facts = EconomicFacts(tenant_id="t", period="p", data={"x": 1})
        assert facts.tenant_id == "t"
        assert facts.period == "p"
        assert facts.data["x"] == 1

    def test_pathologies_catalog_not_empty(self):
        assert len(PATHOLOGIES) >= 5


# ── evaluate_trigger operators ────────────────────────────────────────────────

class TestEvaluatorOperators:
    def test_trigger_truthy_true(self):
        assert evaluate_trigger(TriggerCondition("x", "truthy"), {"x": 100}) is True

    def test_trigger_truthy_false(self):
        assert evaluate_trigger(TriggerCondition("x", "truthy"), {"x": 0}) is False

    def test_trigger_truthy_none(self):
        assert evaluate_trigger(TriggerCondition("x", "truthy"), {"x": None}) is False

    def test_trigger_absent(self):
        assert evaluate_trigger(TriggerCondition("x", "absent"), {}) is True
        assert evaluate_trigger(TriggerCondition("x", "absent"), {"x": 1}) is False

    def test_trigger_present(self):
        assert evaluate_trigger(TriggerCondition("x", "present"), {"x": 1}) is True
        assert evaluate_trigger(TriggerCondition("x", "present"), {}) is False

    def test_trigger_gt(self):
        assert evaluate_trigger(TriggerCondition("x", "gt", value=5.0), {"x": 10}) is True
        assert evaluate_trigger(TriggerCondition("x", "gt", value=5.0), {"x": 5}) is False

    def test_trigger_lte(self):
        assert evaluate_trigger(TriggerCondition("x", "lte", value=0), {"x": -1}) is True
        assert evaluate_trigger(TriggerCondition("x", "lte", value=0), {"x": 1}) is False


# ── evaluate_pathology ────────────────────────────────────────────────────────

class TestEvaluatorLogic:
    def test_logistics_blind_matches_on_absent_field(self):
        facts = EconomicFacts(tenant_id="t", period="p", data={})
        spec = next(p for p in PATHOLOGIES if p.pathology_id == "LOGISTICS_BLIND")
        unit = evaluate_pathology(spec, facts)
        assert unit.status == EvaluationStatus.MATCHED
        assert unit.kind == InterpretationKind.LEVER

    def test_business_target_ref_fallback_to_tenant(self):
        facts = EconomicFacts(
            tenant_id="tenant_fallback",
            period="p",
            data={"revenue": 1_000, "gross_margin": -10},
        )
        spec = next(p for p in PATHOLOGIES if p.pathology_id == "VOL_NO_MARGIN")
        unit = evaluate_pathology(spec, facts)
        assert unit.status == EvaluationStatus.MATCHED
        assert unit.target_ref.name == "tenant_fallback"
        assert unit.target_ref.identifier == "tenant_fallback"

    def test_cost_replacement_ignored_does_not_match_low_inflation(self):
        facts = EconomicFacts(
            tenant_id="t",
            period="p",
            data={"inflation_rate": 0.02, "replacement_cost": 100},
        )
        spec = next(p for p in PATHOLOGIES if p.pathology_id == "COST_REPLACEMENT_IGNORED")
        unit = evaluate_pathology(spec, facts)
        assert unit.status == EvaluationStatus.NOT_MATCHED
        assert unit.confidence == 0.0

    def test_target_ref_populated_for_channel(self, heavy_facts):
        spec = next(p for p in PATHOLOGIES if p.pathology_id == "PARASITE_CHANNEL")
        unit = evaluate_pathology(spec, heavy_facts)
        assert unit.status == EvaluationStatus.MATCHED
        assert unit.target_ref.name == "Channel_1"


# ── interpret (engine end-to-end) ─────────────────────────────────────────────

class TestInterpretEngine:
    def test_returns_interpretation_output_instance(self, minimal_bundle):
        output = interpret(minimal_bundle)
        assert isinstance(output, InterpretationOutput)

    def test_output_carries_tenant_and_period(self, minimal_bundle):
        output = interpret(minimal_bundle)
        assert output.tenant_id == "t_001"
        assert output.period == "2023-Q4"

    def test_output_pathologies_is_list(self, minimal_bundle):
        output = interpret(minimal_bundle)
        assert isinstance(output.pathologies, list)

    def test_output_executive_summary_nonempty(self, minimal_bundle):
        output = interpret(minimal_bundle)
        assert isinstance(output.executive_summary, str)
        assert output.executive_summary.strip()

    def test_output_key_questions_is_list(self, minimal_bundle):
        output = interpret(minimal_bundle)
        assert isinstance(output.key_questions, list)
        assert len(output.key_questions) >= 1

    def test_heavy_facts_detect_active_pathologies(self, minimal_bundle):
        output = interpret(minimal_bundle)
        assert len(output.pathologies) > 0

    def test_output_risk_buckets_are_lists(self, minimal_bundle):
        output = interpret(minimal_bundle)
        assert isinstance(output.profitability_risk, list)
        assert isinstance(output.growth_blockers, list)
        assert isinstance(output.growth_levers, list)
        assert isinstance(output.data_blindness, list)

    def test_collect_evidence_gaps_participates_in_interpret_flow(self):
        facts = EconomicFacts(tenant_id="t_gap", period="2023-Q4", data={})
        bundle = InterpretationBundle(tenant_id="t_gap", period="2023-Q4", facts=facts)

        gaps = collect_evidence_gaps(bundle)
        assert len(gaps) > 0

        output = interpret(bundle)
        assert output.key_questions[0] == f"¿Podemos relevar {gaps[0].missing_field}?"
