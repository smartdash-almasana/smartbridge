import sqlite3
from typing import Any, Callable

from app.services.signals.lifecycle_persistence import _require_non_empty_str


def close_signal(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, str]:
    tenant_id = _require_non_empty_str(payload, "tenant_id")
    signal_code = _require_non_empty_str(payload, "signal_code")
    entity_ref = _require_non_empty_str(payload, "entity_ref")
    ingestion_id = _require_non_empty_str(payload, "ingestion_id")
    timestamp = _require_non_empty_str(payload, "timestamp")

    row = conn.execute(
        """
        SELECT id, is_active
        FROM signals_current
        WHERE signal_code = ? AND entity_ref = ? AND tenant_id = ?
        LIMIT 1
        """,
        (signal_code, entity_ref, tenant_id),
    ).fetchone()

    if row is None:
        raise ValueError("signal_not_found")

    signal_id = row[0]
    is_active = int(row[1])

    if is_active == 0:
        return {"status": "ok"}

    conn.execute(
        """
        UPDATE signals_current
        SET is_active = 0, last_seen_at = ?, ingestion_id = ?
        WHERE id = ?
        """,
        (timestamp, ingestion_id, signal_id),
    )
    conn.execute(
        """
        INSERT INTO signals_history (
            tenant_id, signal_code, entity_ref, ingestion_id, event_type, created_at
        )
        VALUES (?, ?, ?, ?, 'closed', ?)
        """,
        (tenant_id, signal_code, entity_ref, ingestion_id, timestamp),
    )
    conn.commit()
    return {"status": "ok"}


def register_database_close_signal(
    tool_registry: dict[str, Callable[[dict[str, Any]], dict[str, str]]],
    conn: sqlite3.Connection,
) -> None:
    tool_registry["database.close_signal"] = lambda payload: close_signal(conn, payload)
