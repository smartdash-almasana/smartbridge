"""
Job persistence service.
Stores pending pipeline jobs so they can be explicitly rerun after
human clarification without auto-triggering action_engine.
"""
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DB_PATH = Path("data/clarifications.db")  # shared DB file


def _get_connection() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(str(_DB_PATH))


def _create_jobs_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_jobs (
            job_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            file_a TEXT NOT NULL,
            file_b TEXT NOT NULL,
            ingestion_id TEXT NOT NULL,
            correlation_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def save_job(
    tenant_id: str,
    file_a: str,
    file_b: str,
    ingestion_id: str,
    correlation_id: str,
    timestamp: str,
) -> str:
    """Persist a blocked job. Returns the new job_id."""
    job_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()

    conn = _get_connection()
    _create_jobs_table(conn)
    conn.execute(
        """
        INSERT INTO pending_jobs
            (job_id, tenant_id, file_a, file_b, ingestion_id, correlation_id, timestamp, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """,
        (job_id, tenant_id, file_a, file_b, ingestion_id, correlation_id, timestamp, created_at),
    )
    conn.commit()
    conn.close()
    return job_id


def get_job(job_id: str) -> dict[str, Any] | None:
    """Return a job dict or None if not found."""
    conn = _get_connection()
    _create_jobs_table(conn)
    row = conn.execute(
        """
        SELECT job_id, tenant_id, file_a, file_b, ingestion_id, correlation_id, timestamp, status, created_at
        FROM pending_jobs WHERE job_id = ?
        """,
        (job_id,),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return {
        "job_id": row[0],
        "tenant_id": row[1],
        "file_a": row[2],
        "file_b": row[3],
        "ingestion_id": row[4],
        "correlation_id": row[5],
        "timestamp": row[6],
        "status": row[7],
        "created_at": row[8],
    }


def mark_job_done(job_id: str) -> None:
    """Mark a job as completed."""
    conn = _get_connection()
    _create_jobs_table(conn)
    conn.execute(
        "UPDATE pending_jobs SET status = 'done' WHERE job_id = ?",
        (job_id,),
    )
    conn.commit()
    conn.close()
