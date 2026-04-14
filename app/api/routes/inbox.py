"""Operational inbox route (read-only)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.services.inbox_service import get_operational_inbox

router = APIRouter(tags=["inbox"])


@router.get("/inbox", response_model=dict)
def get_inbox(tenant_id: str = Query(...)) -> dict[str, Any]:
    try:
        return get_operational_inbox(tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Avoid leaking internals in public 500 responses.
        raise HTTPException(status_code=500, detail="Internal inbox error") from exc

