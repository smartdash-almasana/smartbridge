"""
Adapter: smartcounter_core findings → existing signals system.
Isolated bridge layer — does not touch action_engine or lifecycle tables.
"""
from typing import Any


def findings_to_signals(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Convert smartcounter_core findings into signal dicts for signals_engine.
    Output uses 'type' so signals_engine.build_signals can map it correctly.
    """
    return [
        {
            "type": "stock_mismatch_detected",
            "entity_ref": f["entity_name"],
            "payload": {
                "difference": f["difference"],
                "source_a": f["source_a"],
                "source_b": f["source_b"],
            },
        }
        for f in findings
    ]
