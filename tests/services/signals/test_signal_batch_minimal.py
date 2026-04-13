import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.services.signals.lifecycle_persistence import register_database_upsert_signal
import app.services.signals.batch_processor as batch_processor


def run_tests() -> None:
    conn = sqlite3.connect(":memory:")
    tools: dict = {}
    register_database_upsert_signal(tools, conn)

    dispatched_calls: list[tuple[str, str, str]] = []

    def mcp_execute(tool_name: str, payload: dict) -> dict:
        if tool_name not in tools:
            raise ValueError(f"Unknown MCP tool: {tool_name}")
        return tools[tool_name](payload)

    def dispatch(signal: dict, ingestion_id: str, correlation_id: str) -> dict:
        dispatched_calls.append((signal["signal_code"], signal["entity_ref"], ingestion_id))
        return {"status": "ok"}

    batch_processor.mcp_execute = mcp_execute
    batch_processor.dispatch = dispatch

    # Test 1: deterministic ordering
    result1 = batch_processor.process_signal_batch(
        signals=[
            {"signal_code": "b", "entity_ref": "2"},
            {"signal_code": "a", "entity_ref": "1"},
        ],
        ingestion_id="ing_test_001",
        correlation_id="corr_test_001",
        timestamp="2026-04-11T12:00:00Z",
    )
    assert result1 == {"batch_status": "success", "processed": 2, "failed": 0}
    assert dispatched_calls[0][:2] == ("a", "1")
    assert dispatched_calls[1][:2] == ("b", "2")

    # Test 2: duplicate signal twice, current has 1 row, history has 2 rows, processed=2
    dispatched_calls.clear()
    result2 = batch_processor.process_signal_batch(
        signals=[
            {"signal_code": "dup", "entity_ref": "x"},
            {"signal_code": "dup", "entity_ref": "x"},
        ],
        ingestion_id="ing_test_002",
        correlation_id="corr_test_002",
        timestamp="2026-04-11T12:05:00Z",
    )
    assert result2 == {"batch_status": "success", "processed": 2, "failed": 0}

    current_dup = conn.execute(
        """
        SELECT COUNT(*)
        FROM signals_current
        WHERE signal_code = ? AND entity_ref = ?
        """,
        ("dup", "x"),
    ).fetchone()[0]
    history_dup = conn.execute(
        """
        SELECT COUNT(*)
        FROM signals_history
        WHERE signal_code = ? AND entity_ref = ?
        """,
        ("dup", "x"),
    ).fetchone()[0]
    assert current_dup == 1
    assert history_dup == 2

    # Test 3: failure on second signal -> processed=1, failed=1, batch stops
    dispatched_calls.clear()
    call_counter = {"n": 0}

    def failing_dispatch(signal: dict, ingestion_id: str, correlation_id: str) -> dict:
        call_counter["n"] += 1
        if call_counter["n"] == 2:
            raise RuntimeError("simulated dispatcher failure")
        dispatched_calls.append((signal["signal_code"], signal["entity_ref"], ingestion_id))
        return {"status": "ok"}

    batch_processor.dispatch = failing_dispatch

    result3 = batch_processor.process_signal_batch(
        signals=[
            {"signal_code": "a", "entity_ref": "1"},
            {"signal_code": "b", "entity_ref": "2"},
            {"signal_code": "c", "entity_ref": "3"},
        ],
        ingestion_id="ing_test_003",
        correlation_id="corr_test_003",
        timestamp="2026-04-11T12:10:00Z",
    )

    assert result3 == {"batch_status": "failed", "processed": 1, "failed": 1}
    assert len(dispatched_calls) == 1
    assert dispatched_calls[0][:2] == ("a", "1")


if __name__ == "__main__":
    run_tests()
    print("ok")


