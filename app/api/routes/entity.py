from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel

from app.services.entity_resolution_service import resolve_entity

router = APIRouter(prefix="/entity", tags=["entity"])

class Candidate(BaseModel):
    entity_id: str
    reason: str

class EntityResolutionRequest(BaseModel):
    input_data: Any
    entities: List[Any]

class EntityResolutionResponse(BaseModel):
    status: str
    entity_id: Optional[str] = None
    confidence: float
    candidates: List[Candidate]

@router.post("/resolve", response_model=EntityResolutionResponse)
def resolve_entity_endpoint(request: EntityResolutionRequest):
    # Servicio simple sin l\u00f3gica adicional más allá del prompt, como se especific\u00f3.
    result = resolve_entity(request.input_data, request.entities)
    return result
