# app/interpretation/pathology_catalog.py
from typing import List
from .types import (
    DiagnosticScope,
    ImpactClass,
    PathologySpec,
    TriggerCondition,
    EvidenceGap,
    InterpretationKind,
    DiagnosticTargetType,
    GapReason,
    ConfidenceRule,
)

PATHOLOGIES: List[PathologySpec] = [
    PathologySpec(
        pathology_id="VOL_NO_MARGIN",
        name="Volumen sin Margen",
        description="La PYME genera ingresos pero opera sin margen bruto positivo.",
        kind=InterpretationKind.PATHOLOGY,
        diagnostic_scope=DiagnosticScope.FINANCIAL,
        impact_class=ImpactClass.HIGH,
        target_type=DiagnosticTargetType.BUSINESS,
        triggers=[
            TriggerCondition(field="revenue", op="gt", value=0),
            TriggerCondition(field="gross_margin", op="lte", value=0),
        ],
        expected_evidence=[
            EvidenceGap("VOL_NO_MARGIN", "revenue", True, "numeric", GapReason.MISSING_DATA),
            EvidenceGap("VOL_NO_MARGIN", "gross_margin", True, "numeric", GapReason.MISSING_DATA),
        ],
        confidence_rule=ConfidenceRule.STRICT,
    ),
    PathologySpec(
        pathology_id="ZOMBIE_CAPITAL",
        name="Capital Zombi",
        description="Inventario inmovilizado con baja rotación.",
        kind=InterpretationKind.BLOCKER,
        diagnostic_scope=DiagnosticScope.OPERATIONAL,
        impact_class=ImpactClass.MEDIUM,
        target_type=DiagnosticTargetType.PRODUCT_LINE,
        triggers=[
            TriggerCondition(field="inventory_days", op="gt", value=180),
            TriggerCondition(field="inventory_turnover", op="lt", value=0.5),
        ],
        expected_evidence=[
            EvidenceGap("ZOMBIE_CAPITAL", "inventory_days", True, "numeric", GapReason.MISSING_DATA),
            EvidenceGap("ZOMBIE_CAPITAL", "inventory_turnover", True, "numeric", GapReason.MISSING_DATA),
        ],
    ),
    PathologySpec(
        pathology_id="PARASITE_CHANNEL",
        name="Canal Parásito",
        description="Un canal consume más margen del que genera.",
        kind=InterpretationKind.PATHOLOGY,
        diagnostic_scope=DiagnosticScope.STRATEGIC,
        impact_class=ImpactClass.HIGH,
        target_type=DiagnosticTargetType.CHANNEL,
        triggers=[
            TriggerCondition(field="channel_margin", op="lt", value=0),
            TriggerCondition(field="channel_revenue_share", op="gt", value=0.2),
        ],
        expected_evidence=[
            EvidenceGap("PARASITE_CHANNEL", "channel_margin", True, "numeric", GapReason.MISSING_DATA),
            EvidenceGap("PARASITE_CHANNEL", "channel_revenue_share", True, "numeric", GapReason.MISSING_DATA),
        ],
    ),
    PathologySpec(
        pathology_id="COST_REPLACEMENT_IGNORED",
        name="Costo de Reposición Ignorado",
        description="Costos contables desalineados en entornos inflacionarios.",
        kind=InterpretationKind.BLOCKER,
        diagnostic_scope=DiagnosticScope.FINANCIAL,
        impact_class=ImpactClass.HIGH,
        target_type=DiagnosticTargetType.BUSINESS,
        triggers=[
            TriggerCondition(field="inflation_rate", op="gt", value=0.05),
        ],
        expected_evidence=[
            EvidenceGap("COST_REPLACEMENT_IGNORED", "inflation_rate", True, "numeric", GapReason.MISSING_DATA),
            EvidenceGap("COST_REPLACEMENT_IGNORED", "replacement_cost", False, "numeric", GapReason.LOGIC_DEPENDENT),
        ],
        confidence_rule=ConfidenceRule.STRICT,
    ),
    PathologySpec(
        pathology_id="LOGISTICS_BLIND",
        name="Logística Ciega",
        description="Falta visibilidad de costos logísticos unitarios.",
        kind=InterpretationKind.LEVER,
        diagnostic_scope=DiagnosticScope.DATA_QUALITY,
        impact_class=ImpactClass.MEDIUM,
        target_type=DiagnosticTargetType.BUSINESS,
        triggers=[
            TriggerCondition(field="logistics_cost_per_unit", op="absent"),
        ],
        expected_evidence=[
            EvidenceGap("LOGISTICS_BLIND", "logistics_cost_per_unit", False, "numeric", GapReason.MISSING_DATA),
            EvidenceGap("LOGISTICS_BLIND", "delivery_volume", False, "numeric", GapReason.LOGIC_DEPENDENT),
        ],
    ),
]