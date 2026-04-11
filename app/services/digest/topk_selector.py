from typing import Any

def select_top_signals(signals: list[dict[str, Any]], k: int) -> list[dict[str, Any]]:
    """
    Selects the top K most relevant signals deterministically.
    
    Sorting rules:
    1. priority_score (descending)
    2. signal_code (ascending)
    3. entity_ref (ascending)
    4. signal_id (ascending)
    """
    if k <= 0:
        raise ValueError("k must be greater than 0")
        
    if not signals:
        return []
        
    sorted_signals = sorted(
        signals,
        key=lambda s: (
            -s["priority_score"],
            s["signal_code"],
            s["entity_ref"],
            s["signal_id"],
        )
    )
    
    return sorted_signals[:k]


def group_signals_by_entity(signals: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """
    Groups signals by their entity_ref while preserving the original internal order.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    
    for signal in signals:
        entity_ref = signal["entity_ref"]
        if entity_ref not in grouped:
            grouped[entity_ref] = []
        grouped[entity_ref].append(signal)
        
    return grouped
