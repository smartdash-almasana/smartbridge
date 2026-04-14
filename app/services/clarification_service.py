"""
Clarification persistence service for smartcounter uncertainties.
Blocks pipeline until human validation resolves all uncertainties.
"""
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from app.services.audit_trail import log_job_event


_DB_PATH = Path("data/clarifications.db")


def _get_connection() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(str(_DB_PATH))


def create_clarifications_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS clarifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            value_a TEXT NOT NULL,
            value_b TEXT NOT NULL,
            similarity REAL NOT NULL,
            resolved INTEGER NOT NULL DEFAULT 0,
            resolution TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def save_clarifications(uncertainties: list[dict[str, Any]]) -> list[int]:
    """
    Persist uncertainties to the clarifications table.
    Returns list of inserted IDs.
    """
    if not uncertainties:
        return []

    conn = _get_connection()
    create_clarifications_table(conn)

    created_at = datetime.utcnow().isoformat()
    ids = []

    for u in uncertainties:
        cursor = conn.execute(
            """
            INSERT INTO clarifications (value_a, value_b, similarity, resolved, resolution, created_at)
            VALUES (?, ?, ?, 0, NULL, ?)
            """,
            (u["value_a"], u["value_b"], u["similarity"], created_at),
        )
        ids.append(cursor.lastrowid)

    conn.commit()
    conn.close()
    for clarification_id, uncertainty in zip(ids, uncertainties):
        try:
            job_id = str(uncertainty.get("job_id", "unknown_job")).strip() or "unknown_job"
            log_job_event(
                job_id=job_id,
                event_type="clarification_created",
                payload={
                    "clarification_id": clarification_id,
                    "value_a": uncertainty.get("value_a"),
                    "value_b": uncertainty.get("value_b"),
                    "similarity": uncertainty.get("similarity"),
                },
            )
        except Exception:
            # Audit must never break clarification flow.
            pass
    return ids


def get_pending_clarifications() -> list[dict[str, Any]]:
    """Return all unresolved clarifications."""
    conn = _get_connection()
    create_clarifications_table(conn)

    rows = conn.execute(
        """
        SELECT id, value_a, value_b, similarity, resolved, resolution, created_at
        FROM clarifications
        WHERE resolved = 0
        ORDER BY created_at DESC
        """
    ).fetchall()

    conn.close()
    return [
        {
            "id": row[0],
            "value_a": row[1],
            "value_b": row[2],
            "similarity": row[3],
            "resolved": bool(row[4]),
            "resolution": row[5],
            "created_at": row[6],
        }
        for row in rows
    ]


def resolve_clarification(clarification_id: int, resolution: str) -> bool:
    """
    Mark a clarification as resolved.
    Returns True if updated, False if not found.
    """
    conn = _get_connection()
    create_clarifications_table(conn)

    cursor = conn.execute(
        """
        UPDATE clarifications
        SET resolved = 1, resolution = ?
        WHERE id = ? AND resolved = 0
        """,
        (resolution, clarification_id),
    )

    updated = cursor.rowcount > 0
    conn.commit()
    conn.close()
    if updated:
        try:
            log_job_event(
                job_id="unknown_job",
                event_type="clarification_resolved",
                payload={
                    "clarification_id": clarification_id,
                    "resolution": resolution,
                },
            )
        except Exception:
            # Audit must never break clarification flow.
            pass
    return updated


def has_pending_clarifications() -> bool:
    """Check if there are any unresolved clarifications."""
    conn = _get_connection()
    create_clarifications_table(conn)

    count = conn.execute(
        "SELECT COUNT(*) FROM clarifications WHERE resolved = 0"
    ).fetchone()[0]

    conn.close()
    return count > 0
