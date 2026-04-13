import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.services.signals.lifecycle_persistence import register_database_upsert_signal


def mcp_execute(
    tool_name: str,
    payload: dict,
    tool_registry: dict,
) -> dict:
    if tool_name not in tool_registry:
        raise ValueError(f"Unknown MCP tool: {tool_name}")
    return tool_registry[tool_name](payload)


def run_tests() -> None:
    conn = sqlite3.connect(":memory:")
    tools: dict = {}
    register_database_upsert_signal(tools, conn)

    payload_a1 = {
        "signal_code": "order_mismatch",
        "entity_ref": "order_123",
        "ingestion_id": "ing_test_001",
        "timestamp": "2026-04-11T12:00:00Z",
    }
    payload_a2 = {
        "signal_code": "order_mismatch",
        "entity_ref": "order_123",
        "ingestion_id": "ing_test_002",
        "timestamp": "2026-04-11T12:05:00Z",
    }
    payload_b = {
        "signal_code": "order_missing_in_documents",
        "entity_ref": "order_999",
        "ingestion_id": "ing_test_003",
        "timestamp": "2026-04-11T12:10:00Z",
    }

    # Test 1: same signal twice -> current=1, history=2 (created+updated)
    assert mcp_execute("database.upsert_signal", payload_a1, tools) == {"status": "ok"}
    assert mcp_execute("database.upsert_signal", payload_a2, tools) == {"status": "ok"}

    current_same = conn.execute(
        """
        SELECT COUNT(*)
        FROM signals_current
        WHERE signal_code = ? AND entity_ref = ?
        """,
        ("order_mismatch", "order_123"),
    ).fetchone()[0]
    history_same = conn.execute(
        """
        SELECT COUNT(*)
        FROM signals_history
        WHERE signal_code = ? AND entity_ref = ?
        """,
        ("order_mismatch", "order_123"),
    ).fetchone()[0]
    assert current_same == 1
    assert history_same == 2

    # Test 2: different signal -> new current row + created history
    assert mcp_execute("database.upsert_signal", payload_b, tools) == {"status": "ok"}
    current_all = conn.execute("SELECT COUNT(*) FROM signals_current").fetchone()[0]
    history_created_b = conn.execute(
        """
        SELECT COUNT(*)
        FROM signals_history
        WHERE signal_code = ? AND entity_ref = ? AND event_type = 'created'
        """,
        ("order_missing_in_documents", "order_999"),
    ).fetchone()[0]
    assert current_all == 2
    assert history_created_b == 1

    # Test 3: missing ingestion_id -> fail
    failed = False
    try:
        mcp_execute(
            "database.upsert_signal",
            {
                "signal_code": "order_mismatch",
                "entity_ref": "order_123",
                "timestamp": "2026-04-11T12:15:00Z",
            },
            tools,
        )
    except ValueError:
        failed = True
    assert failed is True


if __name__ == "__main__":
    run_tests()
    print("ok")


