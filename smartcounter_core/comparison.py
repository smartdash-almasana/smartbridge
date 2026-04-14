"""Entity comparison for smartcounter_core."""
from typing import Any, Dict, List


def compare_entities(entities: List[Any]) -> List[Dict[str, Any]]:
    """Compare matched entities and return comparison results."""
    comparisons = []
    for entity in entities:
        diff = entity.source_a.get("quantity", 0) - entity.source_b.get("quantity", 0)
        comparisons.append({
            "entity_name": entity.canonical_name,
            "difference": diff,
            "source_a": entity.source_a,
            "source_b": entity.source_b,
        })
    return comparisons