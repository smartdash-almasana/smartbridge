import sqlite3

import signals_engine
from app.services.signals.close_signal import close_signal
from app.services.signals.global_signals import compute_signal_lifecycle
from app.services.signals.lifecycle_persistence import (
    create_signals_lifecycle_tables,
    upsert_signal,
)
from app.services.signals.load_current_signals import load_current_signals


def _apply_lifecycle_to_db(conn: sqlite3.Connection, lifecycle_result: dict, ingestion_id: str, timestamp: str) -> None:
    for signal in lifecycle_result["current"]:
        upsert_signal(
            conn,
            {
                "signal_code": signal["signal_code"],
                "entity_ref": signal["entity_ref"],
                "ingestion_id": ingestion_id,
                "timestamp": timestamp,
            },
        )

    for signal in lifecycle_result["lifecycle"]["resolved"]:
        close_signal(
            conn,
            {
                "signal_code": signal["signal_code"],
                "entity_ref": signal["entity_ref"],
                "ingestion_id": ingestion_id,
                "timestamp": timestamp,
            },
        )


def test_lifecycle_to_db_persists_and_closes_correctly() -> None:
    conn = sqlite3.connect(":memory:")
    create_signals_lifecycle_tables(conn)

    current_1 = signals_engine.build_signals(
        findings=[
            {"type": "amount_mismatch", "severity": "high", "metadata": {"order_id": "100"}},
            {"type": "missing_amount", "severity": "medium", "metadata": {"order_id": "200"}},
        ],
        tenant_id="tenant-x",
        module="reconciliation",
        created_at="2026-04-01T12:00:00Z",
    )
    lc_1 = compute_signal_lifecycle([], current_1)
    _apply_lifecycle_to_db(conn, lc_1, "ing_1", "2026-04-01T12:00:00Z")

    active_after_run_1 = conn.execute("SELECT COUNT(*) FROM signals_current WHERE is_active = 1").fetchone()[0]
    assert active_after_run_1 == 2

    current_2 = signals_engine.build_signals(
        findings=[{"type": "amount_mismatch", "severity": "high", "metadata": {"order_id": "100"}}],
        tenant_id="tenant-x",
        module="reconciliation",
        created_at="2026-04-01T12:05:00Z",
    )
    lc_2 = compute_signal_lifecycle(lc_1["current"], current_2)
    _apply_lifecycle_to_db(conn, lc_2, "ing_2", "2026-04-01T12:05:00Z")

    active_after_run_2 = conn.execute("SELECT COUNT(*) FROM signals_current WHERE is_active = 1").fetchone()[0]
    inactive_after_run_2 = conn.execute("SELECT COUNT(*) FROM signals_current WHERE is_active = 0").fetchone()[0]
    closed_events = conn.execute("SELECT COUNT(*) FROM signals_history WHERE event_type = 'closed'").fetchone()[0]

    assert active_after_run_2 == 1
    assert inactive_after_run_2 == 1
    assert closed_events == 1

    loaded = load_current_signals(conn)
    assert loaded == [
        {
            "signal_code": "order_mismatch",
            "entity_ref": "order_100",
            "source_module": "unknown",
        }
    ]


def test_lifecycle_to_db_rejects_invalid_upsert_payload() -> None:
    conn = sqlite3.connect(":memory:")
    create_signals_lifecycle_tables(conn)

    try:
        upsert_signal(conn, {"signal_code": "order_mismatch", "entity_ref": "order_1", "ingestion_id": "ing_1"})
        assert False, "Expected ValueError"
    except ValueError as exc:
        assert "timestamp" in str(exc)

