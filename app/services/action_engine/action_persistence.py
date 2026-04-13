import sqlite3
from typing import Any


def create_actions_table(conn: sqlite3.Connection) -> None:
    with conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS actions_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                signal_code TEXT NOT NULL,
                entity_ref TEXT NOT NULL,
                action_type TEXT NOT NULL,
                status TEXT NOT NULL,
                ingestion_id TEXT NOT NULL,
                correlation_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


def _require_non_empty_str(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned if cleaned else None


def persist_action(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, str]:
    create_actions_table(conn)

    tenant_id = _require_non_empty_str(payload, "tenant_id")
    signal_code = _require_non_empty_str(payload, "signal_code")
    entity_ref = _require_non_empty_str(payload, "entity_ref")
    action_type = _require_non_empty_str(payload, "action_type")
    status = _require_non_empty_str(payload, "status")
    ingestion_id = _require_non_empty_str(payload, "ingestion_id")
    correlation_id = _require_non_empty_str(payload, "correlation_id")
    created_at = _require_non_empty_str(payload, "created_at")

    if not all((tenant_id, signal_code, entity_ref, action_type, status, ingestion_id, correlation_id, created_at)):
        return {"status": "skipped"}

    exists = conn.execute(
        """
        SELECT 1
        FROM actions_history
        WHERE signal_code = ?
          AND entity_ref = ?
          AND ingestion_id = ?
          AND tenant_id = ?
        LIMIT 1
        """,
        (signal_code, entity_ref, ingestion_id, tenant_id),
    ).fetchone()
    if exists is not None:
        return {"status": "ok"}

    with conn:
        conn.execute(
            """
            INSERT INTO actions_history (
                tenant_id, signal_code, entity_ref, action_type, status,
                ingestion_id, correlation_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tenant_id,
                signal_code,
                entity_ref,
                action_type,
                status,
                ingestion_id,
                correlation_id,
                created_at,
            ),
        )
    return {"status": "ok"}
