"""
app/api/server.py
-----------------
Public API layer for SmartBridge signal pipeline.

POST /api/v1/process
  - Accepts raw data rows + tenant_id
  - Runs through findings_engine → run_pipeline
  - Returns signals, lifecycle, and summary

No auth in this phase. No new engines. No duplicated logic.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from app.services.findings_engine import build_findings
from app.services.orchestrator.run_pipeline import run_pipeline
from app.api.routes.clarifications import router as clarifications_router

router = APIRouter(prefix="/api/v1", tags=["pipeline"])


class ProcessRequest(BaseModel):
    tenant_id: str
    data: list[dict[str, Any]]

    @field_validator("tenant_id")
    @classmethod
    def tenant_id_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("tenant_id must be a non-empty string")
        return v.strip()

    @field_validator("data")
    @classmethod
    def data_must_be_list(cls, v: Any) -> list:
        if not isinstance(v, list):
            raise ValueError("data must be a list")
        return v


class SignalSummary(BaseModel):
    total: int
    open: int
    persisting: int
    resolved: int


class ProcessResponse(BaseModel):
    signals: list[dict[str, Any]]
    lifecycle: dict[str, Any]
    summary: SignalSummary


@router.post("/process", response_model=ProcessResponse)
def process_endpoint(request: ProcessRequest) -> ProcessResponse:
    """
    Run the full signal pipeline for a tenant.

    Flow: data → findings_engine.build_findings → run_pipeline → structured response
    """
    try:
        findings = build_findings(request.data)

        result = run_pipeline(
            findings=findings,
            tenant_id=request.tenant_id,
            source_module="api",
            ingestion_id=uuid.uuid4().hex,
            correlation_id=uuid.uuid4().hex,
            timestamp=datetime.now(timezone.utc).isoformat(),
            previous_signals=[],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Internal pipeline error") from exc

    lifecycle = result["lifecycle"]
    summary = SignalSummary(
        total=len(result["signals"]),
        open=len(lifecycle.get("open", [])),
        persisting=len(lifecycle.get("persisting", [])),
        resolved=len(lifecycle.get("resolved", [])),
    )

    return ProcessResponse(
        signals=result["signals"],
        lifecycle=lifecycle,
        summary=summary,
    )
