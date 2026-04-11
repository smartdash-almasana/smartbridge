"""
routes/reconcile.py
--------------------
FastAPI route layer for POST /reconcile.

Responsibilities (and ONLY these):
    1. Declare request schema via Pydantic.
    2. Log the incoming request.
    3. Call the module adapter (domain layer).
    4. Call the ingestion service (persistence layer).
    5. Return a structured, domain-clean response.

Zero business logic lives here.
Infrastructure terms (ingestion_id, path) are surfaced in the
reconciliation_meta sub-key to keep the root response domain-clean.
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.reconciliation.module_adapter import build_reconciliation_module_payload
from app.services.ingestion.service import persist_module_payload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reconcile", tags=["reconcile"])


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class ReconcileRequest(BaseModel):
    """
    Payload for POST /reconcile.

    events    : raw order event records from SmartSeller.
    documents : raw order document records from SmartCounter.
    """

    events: list[dict[str, Any]] = Field(
        ...,
        description="Raw order event records from SmartSeller.",
    )
    documents: list[dict[str, Any]] = Field(
        ...,
        description="Raw order document records from SmartCounter.",
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/",
    summary="Reconcile orders between SmartSeller events and SmartCounter documents.",
    response_description=(
        "SmartCounter module payload with embedded persistence receipt."
    ),
    status_code=status.HTTP_200_OK,
)
def reconcile(payload: ReconcileRequest) -> dict[str, Any]:
    """
    Runs the full reconciliation pipeline and persists the result.

    Pipeline (all inside the service layer):
        1. Normalize both input lists.
        2. Match by order_id.
        3. Diff matched pairs for field discrepancies.
        4. Generate signals.
        5. Wrap in SmartCounter module contract.
        6. Persist artifacts to filesystem (atomic, hash-derived path).

    HTTP status codes:
        200 — success
        400 — domain or contract validation error (ValueError)
        422 — Pydantic input schema violation
        500 — unrecoverable filesystem error (OSError)
    """
    logger.info(
        "POST /reconcile — %d event(s), %d document(s).",
        len(payload.events),
        len(payload.documents),
    )

    # Step 1: Build reconciliation module payload (domain layer)
    try:
        module_payload = build_reconciliation_module_payload(
            payload.events,
            payload.documents,
        )
    except ValueError as exc:
        logger.warning("Reconciliation domain error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    # Step 2: Persist to filesystem (infrastructure layer)
    try:
        persistence_receipt = persist_module_payload(module_payload)
    except ValueError as exc:
        logger.warning("Ingestion contract violation: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except OSError as exc:
        logger.error("Filesystem persistence error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal storage error occurred. Please try again.",
        ) from exc

    # Step 3: Compose response — domain payload + persistence receipt
    # Infrastructure fields are nested under "reconciliation_meta" to keep
    # the root response domain-clean and backward-compatible.
    result: dict[str, Any] = {
        **module_payload,
        "reconciliation_meta": {
            "ingestion_id": persistence_receipt["ingestion_id"],
            "content_hash": persistence_receipt["content_hash"],
            "contract_version": persistence_receipt["contract_version"],
            "path": persistence_receipt["path"],
            "status": persistence_receipt["status"],
        },
    }

    logger.info(
        "POST /reconcile — complete. ingestion_id='%s', health_score=%s.",
        persistence_receipt["ingestion_id"],
        module_payload.get("summary", {}).get("health_score"),
    )

    return result
