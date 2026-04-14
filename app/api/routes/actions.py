"""
app/api/routes/actions.py
-------------------------
Route for controlled execution from confirmed drafts only.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from app.services.action_confirmation_bridge import execute_if_confirmed

router = APIRouter(prefix="/api/v1/actions", tags=["actions"])


class ExecuteConfirmedDraftRequest(BaseModel):
    tenant_id: str
    draft: dict[str, Any]

    @field_validator("tenant_id")
    @classmethod
    def tenant_id_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("tenant_id must be a non-empty string")
        return v.strip()

    @field_validator("draft")
    @classmethod
    def draft_must_be_dict(cls, v: Any) -> dict[str, Any]:
        if not isinstance(v, dict):
            raise ValueError("draft must be an object")
        return v


@router.post("/confirm-execute", response_model=dict)
def confirm_and_execute(body: ExecuteConfirmedDraftRequest) -> dict[str, Any]:
    """
    Execute a draft only when it is explicitly confirmed.
    """
    try:
        return execute_if_confirmed(body.draft, body.tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Internal execution error") from exc

