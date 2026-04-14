"""
app/api/routes/jobs.py
-----------------------
Explicit rerun of a pending job after human clarification.

POST /api/v1/jobs/{job_id}/rerun
  - Blocked if any clarifications remain unresolved
  - Runs pipeline and returns ok + signals + batch_result when clear
  - Does NOT invoke action_engine directly
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.services.clarification_service import has_pending_clarifications
from app.services.job_service import get_job, mark_job_done
from app.services.smartcounter_bridge.execution import (
    persist_uncertainties_if_blocked,
)
from app.services.smartcounter_adapter import findings_to_signals
from app.services.orchestrator.run_pipeline import run_pipeline as orchestrator_run
from smartcounter_core.pipeline import run_pipeline as smartcounter_run_pipeline

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.post("/{job_id}/rerun")
def rerun_job(job_id: str) -> dict[str, Any]:
    """
    Explicitly rerun a blocked job.
    Returns blocked if clarifications remain, ok + signals + batch_result otherwise.
    Does NOT call action_engine directly.
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found")

    if has_pending_clarifications():
        return {
            "status": "blocked",
            "reason": "pending_clarifications",
            "message": "Resolve all clarifications before rerunning.",
            "job_id": job_id,
        }

    result = smartcounter_run_pipeline(job["file_a"], job["file_b"])

    if result["status"] == "blocked":
        # New uncertainties appeared — do not proceed
        persist_uncertainties_if_blocked(result)
        return {**result, "job_id": job_id}

    signals = findings_to_signals(result["findings"])

    orchestrator_result = orchestrator_run(
        findings=signals,
        tenant_id=job["tenant_id"],
        source_module="smartcounter",
        ingestion_id=job["ingestion_id"],
        correlation_id=job["correlation_id"],
        timestamp=job["timestamp"],
        previous_signals=[],
    )

    mark_job_done(job_id)

    return {
        "status": "ok",
        "job_id": job_id,
        "tenant_id": job["tenant_id"],
        "signals": orchestrator_result["signals"],
        "lifecycle": orchestrator_result["lifecycle"],
        "batch_result": orchestrator_result["batch_result"],
    }
