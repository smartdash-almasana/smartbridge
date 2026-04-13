from typing import Any
import sqlite3


def load_current_signals(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT signal_code, entity_ref
        FROM signals_current
        WHERE is_active = 1
        """
    ).fetchall()

    signals: list[dict[str, Any]] = []

    for row in rows:
        signal_code = str(row[0])
        entity_ref = str(row[1])

        signals.append(
            {
                "signal_code": signal_code,
                "entity_ref": entity_ref,
                "source_module": "unknown",  # no está en DB
            }
        )

    return signals
