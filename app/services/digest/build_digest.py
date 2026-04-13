import sqlite3
from types import MappingProxyType
from typing import Any

from app.services.digest.grouping import resolve_signal_group


PRIORITY_MAP: MappingProxyType[str, int] = MappingProxyType(
    {
        "order_missing_in_documents": 3,
        "order_mismatch": 2,
        "order_missing_in_events": 1,
    }
)


def _priority_for_signal(signal_code: str) -> int:
    return PRIORITY_MAP.get(signal_code, 0)


def build_digest(conn: sqlite3.Connection) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT signal_code, entity_ref, last_seen_at
        FROM signals_current
        WHERE is_active = 1
        """
    ).fetchall()

    signals = [
        {
            "signal_code": str(row[0]),
            "entity_ref": str(row[1]),
            "last_seen_at": str(row[2]),
            "priority": _priority_for_signal(str(row[0])),
            "group": resolve_signal_group(str(row[0])),
        }
        for row in rows
    ]

    # Deterministic order source used by all downstream steps:
    # priority DESC, then last_seen_at DESC.
    signals.sort(key=lambda s: (str(s["signal_code"]), str(s["entity_ref"])))
    signals.sort(key=lambda s: str(s["last_seen_at"]), reverse=True)
    signals.sort(key=lambda s: int(s["priority"]), reverse=True)

    return {
        "summary": {
            "total_active_signals": len(signals),
            "signals": signals,
        }
    }
