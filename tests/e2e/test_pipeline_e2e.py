"""
tests/e2e/test_pipeline_e2e.py
-------------------------------
End-to-end validation of the full signal pipeline.

Pipeline under test (real, no mocks except webhook):
    findings_engine → signals_engine → global_signals
    → batch_processor (upsert + dispatch + persist_action)
    → orchestrator (close_signal for resolved)

Only urllib.request.urlopen is mocked to control webhook I/O.
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import app.services.signals.batch_processor as batch_processor
from app.services.action_engine.action_persistence import create_actions_table, persist_action
from app.services.signals.close_signal import register_database_close_signal
from app.services.signals.lifecycle_persistence import (
    create_signals_lifecycle_tables,
    register_database_upsert_signal,
)
from app.services.orchestrator.run_pipeline import run_pipeline

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WEBHOOK_URL = "http://test.local/webhook"
TIMESTAMP_1 = "2026-01-01T10:00:00+00:00"
TIMESTAMP_2 = "2026-01-01T11:00:00+00:00"
TIMESTAMP_3 = "2026-01-01T12:00:00+00:00"

# These findings produce signals with signal_codes that ARE in SIGNAL_CODE_TO_ACTION_TYPE
FINDING_A = {
    "type": "order_mismatch",
    "severity": "high",
    "entity_id": "E1",
    "metadata": {"order_id": "ORD-001"},
}
FINDING_B = {
    "type": "order_mismatch",
    "severity": "high",
    "entity_id": "E2",
    "metadata": {"order_id": "ORD-002"},
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "signals_e2e.db"


@pytest.fixture()
def db_conn(db_path: Path):
    conn = sqlite3.connect(str(db_path))
    create_signals_lifecycle_tables(conn)
    create_actions_table(conn)
    yield conn
    conn.close()


@pytest.fixture(autouse=True)
def wire_batch_processor(db_conn: sqlite3.Connection):
    """
    Wire batch_processor.mcp_execute to real SQLite tool registry.
    Restore after each test.
    """
    tools: dict[str, Any] = {}
    register_database_upsert_signal(tools, db_conn)
    register_database_close_signal(tools, db_conn)

    # persist_action uses db_conn directly
    tools["database.persist_action"] = lambda payload: persist_action(db_conn, payload)

    previous_mcp = batch_processor.mcp_execute
    batch_processor.mcp_execute = lambda tool_name, payload: tools[tool_name](payload)
    yield
    batch_processor.mcp_execute = previous_mcp


def _ingestion_id() -> str:
    return uuid.uuid4().hex


def _count(conn: sqlite3.Connection, table: str, where: str = "", params: tuple = ()) -> int:
    sql = f"SELECT COUNT(*) FROM {table}"
    if where:
        sql += f" WHERE {where}"
    return conn.execute(sql, params).fetchone()[0]


def _run(
    findings: list[dict],
    previous_signals: list[dict],
    timestamp: str,
    tenant_id: str = "tenant_test",
) -> dict:
    return run_pipeline(
        findings=findings,
        tenant_id=tenant_id,
        source_module="reconciliation",
        ingestion_id=_ingestion_id(),
        correlation_id="corr-test",
        timestamp=timestamp,
        previous_signals=previous_signals,
    )


# ---------------------------------------------------------------------------
# Test 1 — First run: 2 findings → 2 open signals
# ---------------------------------------------------------------------------

def test_first_run_two_open_signals(db_conn: sqlite3.Connection):
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__ = lambda s: s
        mock_urlopen.return_value.__exit__ = MagicMock(return_value=False)

        result = _run([FINDING_A, FINDING_B], previous_signals=[], timestamp=TIMESTAMP_1)

    # Signals produced
    assert len(result["signals"]) == 2, "Must produce 2 current signals"

    # All open (first run, no previous)
    statuses = {s["status"] for s in result["lifecycle"]["open"]}
    assert statuses == {"open"}
    assert len(result["lifecycle"]["open"]) == 2
    assert result["lifecycle"]["persisting"] == []
    assert result["lifecycle"]["resolved"] == []

    # DB: 2 active rows in signals_current
    assert _count(db_conn, "signals_current", "is_active = 1") == 2

    # DB: actions_history has 2 rows (one per signal)
    assert _count(db_conn, "actions_history") == 2

    # Webhook called once per signal (2 findings × 1 attempt each = 2)
    assert mock_urlopen.call_count == 2


# ---------------------------------------------------------------------------
# Test 2 — Second run (same findings) → persisting
# ---------------------------------------------------------------------------

def test_second_run_persisting(db_conn: sqlite3.Connection):
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__ = lambda s: s
        mock_urlopen.return_value.__exit__ = MagicMock(return_value=False)

        # First run: capture current signals as the previous state
        first = _run([FINDING_A, FINDING_B], previous_signals=[], timestamp=TIMESTAMP_1)
        previous = first["signals"]  # enriched with global_signal_id

        # Second run: same findings, pass first run's signals as previous
        second = _run([FINDING_A, FINDING_B], previous_signals=previous, timestamp=TIMESTAMP_2)

    # All signals are persisting on second run
    assert len(second["lifecycle"]["persisting"]) == 2
    assert second["lifecycle"]["open"] == []
    assert second["lifecycle"]["resolved"] == []

    # signals_current still has only 2 unique rows (no duplicates)
    assert _count(db_conn, "signals_current") == 2

    # actions_history grows: 2 (run1) + 2 (run2) = 4
    assert _count(db_conn, "actions_history") == 4


# ---------------------------------------------------------------------------
# Test 3 — Resolution: remove 1 finding → 1 resolved
# ---------------------------------------------------------------------------

def test_resolution_removes_signal(db_conn: sqlite3.Connection):
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__ = lambda s: s
        mock_urlopen.return_value.__exit__ = MagicMock(return_value=False)

        first = _run([FINDING_A, FINDING_B], previous_signals=[], timestamp=TIMESTAMP_1)
        previous = first["signals"]

        # Second run: only FINDING_A remains
        second = _run([FINDING_A], previous_signals=previous, timestamp=TIMESTAMP_2)

    # Lifecycle: 1 persisting, 1 resolved
    assert len(second["lifecycle"]["persisting"]) == 1
    assert len(second["lifecycle"]["resolved"]) == 1
    assert second["lifecycle"]["open"] == []

    # signals_current: 1 active, 1 inactive (closed)
    assert _count(db_conn, "signals_current", "is_active = 1") == 1
    assert _count(db_conn, "signals_current", "is_active = 0") == 1

    # signals_history: must contain a 'closed' event
    assert _count(db_conn, "signals_history", "event_type = 'closed'") == 1

    # current signals list only contains 1 entry (the persisting one)
    assert len(second["signals"]) == 1


# ---------------------------------------------------------------------------
# Test 4 — Webhook retry: fail then succeed
# ---------------------------------------------------------------------------

def test_webhook_retry_success(db_conn: sqlite3.Connection):
    call_count = 0

    def urlopen_fail_then_succeed(req, timeout=None):
        nonlocal call_count
        call_count += 1
        # The webhook adapter retries per action call.
        # calls 1 = fail (first signal attempt 1), 2 = succeed (retry)
        # We control at the urlopen level.
        if call_count == 1:
            raise OSError("Simulated network failure")
        ctx = MagicMock()
        ctx.__enter__ = lambda s: s
        ctx.__exit__ = MagicMock(return_value=False)
        return ctx

    with patch("urllib.request.urlopen", side_effect=urlopen_fail_then_succeed):
        result = _run([FINDING_A], previous_signals=[], timestamp=TIMESTAMP_1)

    # Webhook was called twice for FINDING_A (1 fail + 1 succeed)
    assert call_count == 2, f"Expected 2 urlopen calls, got {call_count}"

    # Pipeline did not crash; signal is persisted
    assert _count(db_conn, "signals_current", "is_active = 1") == 1
    assert _count(db_conn, "actions_history") == 1


# ---------------------------------------------------------------------------
# Test 5 — Webhook retry exhausted: all 3 attempts fail
# ---------------------------------------------------------------------------

def test_webhook_retry_all_fail(db_conn: sqlite3.Connection):
    call_count = 0

    def urlopen_always_fail(req, timeout=None):
        nonlocal call_count
        call_count += 1
        raise OSError("Simulated persistent failure")

    with patch("urllib.request.urlopen", side_effect=urlopen_always_fail):
        # Pipeline must NOT crash even if webhook always fails
        result = _run([FINDING_A], previous_signals=[], timestamp=TIMESTAMP_1)

    # webhook_adapter makes max 3 attempts
    assert call_count == 3, f"Expected 3 urlopen calls, got {call_count}"

    # Pipeline continued: signal is upserted, action is persisted
    assert _count(db_conn, "signals_current", "is_active = 1") == 1
    assert _count(db_conn, "actions_history") == 1

    # batch_processor reports success (webhook failure is swallowed by execute_action_from_signal)
    assert result["batch_result"]["batch_status"] == "success"


# ---------------------------------------------------------------------------
# Test 6 — Tenant isolation: tenant A and B do not see each other's signals
# ---------------------------------------------------------------------------

def test_tenant_isolation(db_conn: sqlite3.Connection):
    """Signals from tenant A must not appear as signals for tenant B."""
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__ = lambda s: s
        mock_urlopen.return_value.__exit__ = MagicMock(return_value=False)

        # Tenant A: 2 findings → 2 signals
        _run([FINDING_A, FINDING_B], previous_signals=[], timestamp=TIMESTAMP_1, tenant_id="tenant_A")

        # Tenant B: 1 finding → 1 signal (different tenant, same entity data)
        _run([FINDING_A], previous_signals=[], timestamp=TIMESTAMP_1, tenant_id="tenant_B")

    # Total rows in signals_current: 3 (2 for A, 1 for B)
    assert _count(db_conn, "signals_current", "is_active = 1") == 3

    # Tenant A: 2 active signals
    assert _count(db_conn, "signals_current", "tenant_id = 'tenant_A' AND is_active = 1") == 2

    # Tenant B: 1 active signal
    assert _count(db_conn, "signals_current", "tenant_id = 'tenant_B' AND is_active = 1") == 1

    # Tenant A actions: 2
    assert _count(db_conn, "actions_history", "tenant_id = 'tenant_A'") == 2

    # Tenant B actions: 1
    assert _count(db_conn, "actions_history", "tenant_id = 'tenant_B'") == 1
