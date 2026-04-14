"""Execution helpers for SmartCounter bridge flow.

This module centralizes core pipeline execution, blocked uncertainty persistence,
and orchestrator handoff to reduce coupling across entrypoints.
"""
from typing import Any

from smartcounter_core.pipeline import run_pipeline as smartcounter_run_pipeline

from app.services.clarification_service import save_clarifications
from app.services.orchestrator.run_pipeline import run_pipeline as orchestrator_run
from app.services.smartcounter_adapter import findings_to_signals


def run_core_pipeline(file_a: str, file_b: str) -> dict[str, Any]:
    """Run SmartCounter core pipeline for two input files."""
    return smartcounter_run_pipeline(file_a, file_b)


def persist_uncertainties_if_blocked(result: dict[str, Any]) -> None:
    """Persist uncertainties when the core pipeline is blocked."""
    if result["status"] == "blocked":
        save_clarifications(result["uncertainties"])


def run_orchestrator_from_findings(
    *,
    findings: list[dict[str, Any]],
    tenant_id: str,
    ingestion_id: str,
    correlation_id: str,
    timestamp: str,
    previous_signals: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Convert findings into signals and pass them through orchestrator flow."""
    signals = findings_to_signals(findings)
    return orchestrator_run(
        findings=signals,
        tenant_id=tenant_id,
        source_module="smartcounter",
        ingestion_id=ingestion_id,
        correlation_id=correlation_id,
        timestamp=timestamp,
        previous_signals=previous_signals or [],
    )

