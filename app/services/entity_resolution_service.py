"""
Entity Resolution Service
Production-ready hybrid resolution layer (deterministic-first, LLM optional).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

# --- OPTIONAL OPENAI IMPORT ---
try:
    import openai
except ImportError:
    openai = None

from pydantic import BaseModel, Field, ValidationError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data Contracts
# ---------------------------------------------------------------------------

class ResolutionResult(BaseModel):
    status: str = Field(..., pattern="^(resolved|probable|needs_confirmation)$")
    entity_id: Optional[str]
    confidence: float = Field(..., ge=0.0, le=1.0)
    candidates: List[Dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Deterministic Layer
# ---------------------------------------------------------------------------

def match_by_email(input_data: Dict[str, Any], entities: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    from_email = input_data.get("from")
    if not from_email or not isinstance(from_email, str):
        return None

    normalized = from_email.strip().lower()

    for ent in entities:
        for email in ent.get("emails", []):
            if isinstance(email, str) and email.strip().lower() == normalized:
                return ResolutionResult(
                    status="resolved",
                    entity_id=ent["id"],
                    confidence=0.99,
                    candidates=[]
                ).model_dump()
    return None


def match_by_alias(input_data: Dict[str, Any], entities: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    text = input_data.get("text")
    if not text or not isinstance(text, str):
        return None

    text = text.lower()
    matches = []

    for ent in entities:
        for alias in ent.get("alias", []):
            if isinstance(alias, str) and alias.strip().lower() in text:
                matches.append(ent["id"])
                break

    if len(matches) == 1:
        return ResolutionResult(
            status="probable",
            entity_id=matches[0],
            confidence=0.8,
            candidates=[]
        ).model_dump()

    return None


# ---------------------------------------------------------------------------
# LLM Layer (Optional)
# ---------------------------------------------------------------------------

def resolve_with_llm(input_data: Dict[str, Any], entities: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if openai is None:
        logger.warning("OpenAI no disponible. Saltando LLM.")
        return None

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    try:
        client = openai.OpenAI(api_key=api_key)

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Return ONLY JSON."},
                {"role": "user", "content": json.dumps({
                    "input_data": input_data,
                    "entities": entities
                })}
            ],
            temperature=0.0,
        )

        content = response.choices[0].message.content
        data = json.loads(content)

        validated = ResolutionResult(**data)
        return validated.model_dump()

    except Exception as e:
        logger.error(f"LLM error: {e}")
        return None


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def resolve_entity(input_data: Dict[str, Any], entities: List[Dict[str, Any]]) -> Dict[str, Any]:

    if not isinstance(input_data, dict):
        input_data = {}

    if not isinstance(entities, list):
        entities = []

    # 1. email
    result = match_by_email(input_data, entities)
    if result:
        return result

    # 2. alias
    result = match_by_alias(input_data, entities)
    if result:
        return result

    # 3. llm (optional)
    result = resolve_with_llm(input_data, entities)
    if result:
        return result

    # 4. fallback
    return ResolutionResult(
        status="needs_confirmation",
        entity_id=None,
        confidence=0.0,
        candidates=[]
    ).model_dump()
