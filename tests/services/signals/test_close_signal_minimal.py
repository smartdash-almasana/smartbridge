import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.services.signals.lifecycle_persistence import register_database_upsert_signal
from app.services.signals.close_signal import register_database_close_signal


def mcp_execute(tool_name: str, payload: dict, tool_registry: dict) -> dict:
    if tool_name not in tool_registry:
        raise ValueError(f"Unknown MCP tool: {tool_name}")
    return tool_registry[tool_name](payload)


def run_tests() -> None:
    conn = sqlite3.connect(":memory:")
    tools: dict = {}
    register_database_upsert_signal(tools, conn)
    register_database_close_signal(tools, conn)

    # Seed one active signal
    assert mcp_execute(
        "database.upsert_signal",
        {
            "signal_code": "order_mismatch",
            "entity_ref": "order_123",
            "ingestion_id": "ing_seed_001",
            "timestamp": "2026-04-11T14:00:00Z",
        },
        tools,
    ) == {"status": "ok"}

    # Test 1: close existing active signal
    before_hist_1 = conn.execute("SELECT COUNT(*) FROM signals_history").fetchone()[0]
    assert mcp_execute(
        "database.close_signal",
        {
            "signal_code": "order_mismatch",
            "entity_ref": "order_123",
            "ingestion_id": "ing_close_001",
            "timestamp": "2026-04-11T14:05:00Z",
        },
        tools,
    ) == {"status": "ok"}
    is_active_after_close = conn.execute(
        """
        SELECT is_active
        FROM signals_current
        WHERE signal_code = ? AND entity_ref = ?
        """,
        ("order_mismatch", "order_123"),
    ).fetchone()[0]
    after_hist_1 = conn.execute("SELECT COUNT(*) FROM signals_history").fetchone()[0]
    last_event = conn.execute(
        """
        SELECT event_type
        FROM signals_history
        WHERE signal_code = ? AND entity_ref = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        ("order_mismatch", "order_123"),
    ).fetchone()[0]
    assert int(is_active_after_close) == 0
    assert after_hist_1 == before_hist_1 + 1
    assert last_event == "closed"

    # Test 2: close already closed => no-op, no new history row
    before_hist_2 = conn.execute("SELECT COUNT(*) FROM signals_history").fetchone()[0]
    assert mcp_execute(
        "database.close_signal",
        {
            "signal_code": "order_mismatch",
            "entity_ref": "order_123",
            "ingestion_id": "ing_close_002",
            "timestamp": "2026-04-11T14:10:00Z",
        },
        tools,
    ) == {"status": "ok"}
    after_hist_2 = conn.execute("SELECT COUNT(*) FROM signals_history").fetchone()[0]
    assert after_hist_2 == before_hist_2

    # Test 3: close non-existing => fail
    failed = False
    try:
        mcp_execute(
            "database.close_signal",
            {
                "signal_code": "missing_signal",
                "entity_ref": "entity_x",
                "ingestion_id": "ing_close_003",
                "timestamp": "2026-04-11T14:15:00Z",
            },
            tools,
        )
    except ValueError as exc:
        failed = str(exc) == "signal_not_found"
    assert failed is True


if __name__ == "__main__":
    run_tests()
    print("ok")


