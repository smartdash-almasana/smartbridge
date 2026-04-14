"""Entity resolution for smartcounter_core."""
import uuid
from difflib import SequenceMatcher
from typing import Any, Dict, List, Tuple

from smartcounter_core.models import Entity, Uncertainty


AUTO_MATCH_THRESHOLD = 0.90
UNCERTAINTY_THRESHOLD = 0.75


def compute_similarity(str_a: str, str_b: str) -> float:
    return SequenceMatcher(None, str_a, str_b).ratio()


def resolve_entities(
    rows_a: List[Dict[str, Any]], rows_b: List[Dict[str, Any]]
) -> Tuple[List[Entity], List[Uncertainty]]:
    entities = []
    uncertainties = []
    matched_b_indices = set()

    for idx_a, row_a in enumerate(rows_a):
        best_match_idx = None
        best_similarity = 0.0

        for idx_b, row_b in enumerate(rows_b):
            similarity = compute_similarity(row_a["product_name"], row_b["product_name"])
            if similarity > best_similarity:
                best_similarity = similarity
                best_match_idx = idx_b

        if best_match_idx is None:
            continue

        if best_match_idx in matched_b_indices:
            continue

        if best_similarity >= AUTO_MATCH_THRESHOLD:
            canonical_name = row_a["product_name"]
            entity = Entity(
                entity_id=str(uuid.uuid4()),
                canonical_name=canonical_name,
                aliases=[row_a["product_name"], rows_b[best_match_idx]["product_name"]],
                source_a={"product_name": row_a["product_name"], "quantity": row_a["quantity"]},
                source_b={"product_name": rows_b[best_match_idx]["product_name"], "quantity": rows_b[best_match_idx]["quantity"]},
                confidence=best_similarity,
                validated=True,
            )
            entities.append(entity)
            matched_b_indices.add(best_match_idx)

        elif best_similarity >= UNCERTAINTY_THRESHOLD:
            uncertainty = Uncertainty(
                value_a=row_a["product_name"],
                value_b=rows_b[best_match_idx]["product_name"],
                similarity=round(best_similarity, 4),
                requires_validation=True,
            )
            uncertainties.append(uncertainty)
            matched_b_indices.add(best_match_idx)

    return entities, uncertainties