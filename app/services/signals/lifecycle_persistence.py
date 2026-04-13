import sqlite3
from typing import Any, Callable


def create_signals_lifecycle_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS signals_current (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            signal_code TEXT NOT NULL,
            entity_ref TEXT NOT NULL,
            ingestion_id TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            UNIQUE(signal_code, entity_ref, tenant_id)
        );

        CREATE TABLE IF NOT EXISTS signals_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            signal_code TEXT NOT NULL,
            entity_ref TEXT NOT NULL,
            ingestion_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()


def _require_non_empty_str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Field '{key}' is required and must be a non-empty string.")
    return value.strip()


def upsert_signal(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, str]:
    tenant_id = _require_non_empty_str(payload, "tenant_id")
    signal_code = _require_non_empty_str(payload, "signal_code")
    entity_ref = _require_non_empty_str(payload, "entity_ref")
    ingestion_id = _require_non_empty_str(payload, "ingestion_id")
    timestamp = _require_non_empty_str(payload, "timestamp")

    row = conn.execute(
        """
        SELECT id
        FROM signals_current
        WHERE signal_code = ? AND entity_ref = ? AND tenant_id = ?
        LIMIT 1
        """,
        (signal_code, entity_ref, tenant_id),
    ).fetchone()

    if row is None:
        conn.execute(
            """
            INSERT INTO signals_current (
                tenant_id, signal_code, entity_ref, ingestion_id, first_seen_at, last_seen_at, is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, 1)
            """,
            (tenant_id, signal_code, entity_ref, ingestion_id, timestamp, timestamp),
        )
        conn.execute(
            """
            INSERT INTO signals_history (
                tenant_id, signal_code, entity_ref, ingestion_id, event_type, created_at
            )
            VALUES (?, ?, ?, ?, 'created', ?)
            """,
            (tenant_id, signal_code, entity_ref, ingestion_id, timestamp),
        )
    else:
        conn.execute(
            """
            UPDATE signals_current
            SET last_seen_at = ?, ingestion_id = ?, is_active = 1
            WHERE id = ?
            """,
            (timestamp, ingestion_id, row[0]),
        )
        conn.execute(
            """
            INSERT INTO signals_history (
                tenant_id, signal_code, entity_ref, ingestion_id, event_type, created_at
            )
            VALUES (?, ?, ?, ?, 'updated', ?)
            """,
            (tenant_id, signal_code, entity_ref, ingestion_id, timestamp),
        )

    conn.commit()
    return {"status": "ok"}


def register_database_upsert_signal(
    tool_registry: dict[str, Callable[[dict[str, Any]], dict[str, str]]],
    conn: sqlite3.Connection,
) -> None:
    create_signals_lifecycle_tables(conn)
    tool_registry["database.upsert_signal"] = lambda payload: upsert_signal(conn, payload)
