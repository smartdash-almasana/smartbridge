"""Normalization utilities for smartcounter_core."""
from typing import Any, Dict, List


def normalize_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize raw rows to canonical format."""
    # In production, this would normalize field names, types, etc.
    return rows