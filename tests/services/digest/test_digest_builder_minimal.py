import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.services.digest.build_digest import PRIORITY_MAP, build_digest
from app.services.signals.close_signal import register_database_close_signal
from app.services.signals.lifecycle_persistence import register_database_upsert_signal


def mcp_execute(tool_name: str, payload: dict, tool_registry: dict) -> dict:
    if tool_name not in tool_registry:
        raise ValueError(f"Unknown MCP tool: {tool_name}")
    return tool_registry[tool_name](payload)


def _new_tools_and_conn() -> tuple[sqlite3.Connection, dict]:
    conn = sqlite3.connect(":memory:")
    tools: dict = {}
    register_database_upsert_signal(tools, conn)
    register_database_close_signal(tools, conn)
    return conn, tools


def test_priority_override_time() -> None:
    conn, tools = _new_tools_and_conn()
    try:
        mcp_execute(
            "database.upsert_signal",
            {
                "signal_code": "order_missing_in_documents",
                "entity_ref": "order_old_high",
                "ingestion_id": "ing_1",
                "timestamp": "2026-04-11T10:00:00Z",
            },
            tools,
        )
        mcp_execute(
            "database.upsert_signal",
            {
                "signal_code": "order_missing_in_events",
                "entity_ref": "order_new_low",
                "ingestion_id": "ing_2",
                "timestamp": "2026-04-11T12:00:00Z",
            },
            tools,
        )

        digest = build_digest(conn)
        signals = digest["summary"]["signals"]
        assert signals[0]["signal_code"] == "order_missing_in_documents"
        assert int(signals[0]["priority"]) == int(PRIORITY_MAP["order_missing_in_documents"])
        assert signals[1]["signal_code"] == "order_missing_in_events"
    finally:
        conn.close()


def test_equal_priority_last_seen_desc() -> None:
    conn, tools = _new_tools_and_conn()
    try:
        mcp_execute(
            "database.upsert_signal",
            {
                "signal_code": "order_mismatch",
                "entity_ref": "order_old",
                "ingestion_id": "ing_3",
                "timestamp": "2026-04-11T09:00:00Z",
            },
            tools,
        )
        mcp_execute(
            "database.upsert_signal",
            {
                "signal_code": "order_mismatch",
                "entity_ref": "order_new",
                "ingestion_id": "ing_4",
                "timestamp": "2026-04-11T11:00:00Z",
            },
            tools,
        )

        digest = build_digest(conn)
        signals = digest["summary"]["signals"]
        assert signals[0]["entity_ref"] == "order_new"
        assert signals[1]["entity_ref"] == "order_old"
        assert int(signals[0]["priority"]) == int(signals[1]["priority"])
    finally:
        conn.close()


def test_unknown_signal_appears_last_and_other_group() -> None:
    conn, tools = _new_tools_and_conn()
    try:
        mcp_execute(
            "database.upsert_signal",
            {
                "signal_code": "unknown_signal",
                "entity_ref": "order_unknown",
                "ingestion_id": "ing_5",
                "timestamp": "2026-04-11T12:00:00Z",
            },
            tools,
        )
        mcp_execute(
            "database.upsert_signal",
            {
                "signal_code": "order_mismatch",
                "entity_ref": "order_known",
                "ingestion_id": "ing_6",
                "timestamp": "2026-04-11T10:00:00Z",
            },
            tools,
        )

        digest = build_digest(conn)
        signals = digest["summary"]["signals"]
        assert signals[-1]["signal_code"] == "unknown_signal"
        assert int(signals[-1]["priority"]) == 0
        assert signals[-1]["group"] == "other"
    finally:
        conn.close()


def test_priority_map_is_immutable() -> None:
    try:
        PRIORITY_MAP["new_code"] = 7  # type: ignore[index]
        assert False, "Expected TypeError when mutating PRIORITY_MAP"
    except TypeError:
        pass


def run_tests() -> None:
    test_priority_override_time()
    test_equal_priority_last_seen_desc()
    test_unknown_signal_appears_last_and_other_group()
    test_priority_map_is_immutable()


if __name__ == "__main__":
    run_tests()
    print("ok")


