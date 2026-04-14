"""SQLite-backed audit trail for controlled job events."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_DB_PATH = Path("data/audit_trail.db")


def _get_connection() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(str(_DB_PATH))


def _create_events_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS job_audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def log_job_event(job_id: str, event_type: str, payload: dict[str, Any]) -> int:
    """Persist one audit event and return its row id."""
    if not isinstance(job_id, str) or not job_id.strip():
        raise ValueError("'job_id' must be a non-empty string.")
    if not isinstance(event_type, str) or not event_type.strip():
        raise ValueError("'event_type' must be a non-empty string.")
    if not isinstance(payload, dict):
        raise ValueError("'payload' must be a dict.")

    conn = _get_connection()
    _create_events_table(conn)
    created_at = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        """
        INSERT INTO job_audit_events (job_id, event_type, payload, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            job_id.strip(),
            event_type.strip(),
            json.dumps(payload, sort_keys=True, separators=(",", ":")),
            created_at,
        ),
    )
    event_id = int(cursor.lastrowid)
    conn.commit()
    conn.close()
    return event_id


def get_job_events(job_id: str) -> list[dict[str, Any]]:
    """Return events for one job ordered by creation time."""
    if not isinstance(job_id, str) or not job_id.strip():
        raise ValueError("'job_id' must be a non-empty string.")

    conn = _get_connection()
    _create_events_table(conn)
    rows = conn.execute(
        """
        SELECT id, job_id, event_type, payload, created_at
        FROM job_audit_events
        WHERE job_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (job_id.strip(),),
    ).fetchall()
    conn.close()

    events: list[dict[str, Any]] = []
    for row in rows:
        events.append(
            {
                "id": row[0],
                "job_id": row[1],
                "event_type": row[2],
                "payload": json.loads(row[3]),
                "created_at": row[4],
            }
        )
    return events


def list_recent_job_events(limit: int = 200) -> list[dict[str, Any]]:
    """Read recent audit events without creating tables or mutating state."""
    if not isinstance(limit, int) or limit <= 0:
        raise ValueError("'limit' must be a positive integer.")

    if not _DB_PATH.exists():
        return []

    conn = _get_connection()
    try:
        table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_audit_events' LIMIT 1"
        ).fetchone()
        if table_exists is None:
            return []

        rows = conn.execute(
            """
            SELECT id, job_id, event_type, payload, created_at
            FROM job_audit_events
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    finally:
        conn.close()

    events: list[dict[str, Any]] = []
    for row in rows:
        try:
            payload = json.loads(row[3])
            if not isinstance(payload, dict):
                payload = {}
        except Exception:
            payload = {}

        events.append(
            {
                "id": row[0],
                "job_id": row[1],
                "event_type": row[2],
                "payload": payload,
                "created_at": row[4],
            }
        )
    return events

