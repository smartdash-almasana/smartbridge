"""
app/api/routes/clarifications.py
----------------------------------
Human resolution flow for smartcounter uncertainties.

GET  /api/v1/clarifications          → list pending
POST /api/v1/clarifications/{id}/resolve → resolve one by id
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.clarification_service import (
    get_pending_clarifications,
    resolve_clarification,
)

router = APIRouter(prefix="/api/v1/clarifications", tags=["clarifications"])


class ResolveRequest(BaseModel):
    resolution: str


class ClarificationItem(BaseModel):
    id: int
    value_a: str
    value_b: str
    similarity: float
    resolved: bool
    resolution: str | None
    created_at: str


@router.get("", response_model=list[ClarificationItem])
def list_pending() -> list[dict[str, Any]]:
    """Return all unresolved clarifications awaiting human review."""
    return get_pending_clarifications()


@router.post("/{clarification_id}/resolve", response_model=dict)
def resolve(clarification_id: int, body: ResolveRequest) -> dict[str, Any]:
    """
    Resolve a clarification by id.
    After all clarifications are resolved the pipeline will resume on next run.
    """
    if not body.resolution or not body.resolution.strip():
        raise HTTPException(status_code=400, detail="resolution must be a non-empty string")

    updated = resolve_clarification(clarification_id, body.resolution.strip())
    if not updated:
        raise HTTPException(
            status_code=404,
            detail=f"Clarification {clarification_id} not found or already resolved",
        )

    return {"status": "resolved", "id": clarification_id, "resolution": body.resolution.strip()}
