from typing import Any

from smartcounter_core.pipeline import run_pipeline as smartcounter_run_pipeline
from app.services.smartcounter_adapter import findings_to_signals
from app.services.orchestrator.run_pipeline import run_pipeline as orchestrator_run
from app.services.clarification_service import (
    save_clarifications,
    has_pending_clarifications,
)
from app.services.job_service import save_job


def run_pipeline(
    tenant_id: str,
    file_a: str = "",
    file_b: str = "",
    ingestion_id: str = "",
    correlation_id: str = "",
    timestamp: str = "",
    previous_signals: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Entrypoint that bridges smartcounter_core into the existing signals system.
    Falls back to stub when file paths are not provided.
    Blocks on pending clarifications until resolved.
    """
    if not file_a or not file_b:
        return {
            "status": "ok",
            "tenant_id": tenant_id,
            "message": "pipeline stub running",
        }

    # BLOCK: Do not proceed if there are unresolved clarifications
    if has_pending_clarifications():
        return {
            "status": "blocked",
            "reason": "pending_clarifications",
            "message": "Pipeline blocked until all clarifications are resolved.",
        }

    result = smartcounter_run_pipeline(file_a, file_b)

    if result["status"] == "blocked":
        # Persist uncertainties for human validation
        save_clarifications(result["uncertainties"])
        # Persist job so it can be explicitly rerun after resolution
        job_id = save_job(
            tenant_id=tenant_id,
            file_a=file_a,
            file_b=file_b,
            ingestion_id=ingestion_id,
            correlation_id=correlation_id,
            timestamp=timestamp,
        )
        return {**result, "job_id": job_id}

    signals = findings_to_signals(result["findings"])

    orchestrator_result = orchestrator_run(
        findings=signals,
        tenant_id=tenant_id,
        source_module="smartcounter",
        ingestion_id=ingestion_id,
        correlation_id=correlation_id,
        timestamp=timestamp,
        previous_signals=previous_signals or [],
    )

    return {
        "status": "ok",
        "tenant_id": tenant_id,
        "signals": orchestrator_result["signals"],
        "lifecycle": orchestrator_result["lifecycle"],
        "batch_result": orchestrator_result["batch_result"],
    }
