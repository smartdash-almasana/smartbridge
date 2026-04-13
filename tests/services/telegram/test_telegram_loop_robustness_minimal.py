import os
import shutil
import sqlite3
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.services.digest.build_digest import build_digest
from app.services.signals.lifecycle_persistence import register_database_upsert_signal
from app.services.telegram import loop


DIGEST_GROUPED = {
    "summary": {
        "total_active_signals": 2,
        "signals": [
            {
                "signal_code": "order_mismatch",
                "entity_ref": "order_123",
                "last_seen_at": "2026-04-11T15:00:00Z",
                "priority": 2,
                "group": "orders",
            },
            {
                "signal_code": "unknown_signal",
                "entity_ref": "order_456",
                "last_seen_at": "2026-04-11T14:59:00Z",
                "priority": 0,
                "group": "other",
            },
        ],
    }
}


def _new_db_path() -> str:
    base = Path("tests/.tmp")
    base.mkdir(parents=True, exist_ok=True)
    test_dir = base / f"telegram_{uuid.uuid4().hex}"
    test_dir.mkdir(parents=True, exist_ok=True)
    return str(test_dir / "telegram_loop.sqlite3")


def _cleanup_db_path(db_path: str) -> None:
    root = Path(db_path).parent
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)


def _seed_pending(db_path: str, send_impl, mcp_execute, dispatch_stub, digest: dict) -> list[str]:
    os.environ["TELEGRAM_LOOP_DB_PATH"] = db_path

    sent_messages: list[str] = []

    def send_wrapper(text: str) -> dict:
        sent_messages.append(text)
        return send_impl(text)

    loop.configure_telegram_loop(mcp_execute=mcp_execute, send_impl=send_wrapper)
    loop.dispatch_actions = dispatch_stub

    loop.send_digest_confirmation_request(
        digest=digest,
        action={},
        ingestion_id="ing_1",
        correlation_id="corr_1",
        timestamp="2026-04-11T16:00:00Z",
    )
    return sent_messages


def _fetch_pending_positions(db_path: str) -> list[tuple[int, str, str]]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT position, signal_code, entity_ref
            FROM pending_actions
            ORDER BY position ASC
            """
        ).fetchall()
        return [(int(r[0]), str(r[1]), str(r[2])) for r in rows]


def _count_consumed(db_path: str) -> int:
    with sqlite3.connect(db_path) as conn:
        return int(conn.execute("SELECT COUNT(*) FROM pending_actions WHERE is_consumed = 1").fetchone()[0])


def _count_processed_messages(db_path: str) -> int:
    with sqlite3.connect(db_path) as conn:
        return int(conn.execute("SELECT COUNT(*) FROM processed_messages").fetchone()[0])


def test_ordering_integrity_digest_db_message() -> None:
    db_path = _new_db_path()
    try:
        sig_conn = sqlite3.connect(":memory:")
        tools: dict = {}
        register_database_upsert_signal(tools, sig_conn)
        tools["database.upsert_signal"](
            {
                "signal_code": "order_mismatch",
                "entity_ref": "order_1",
                "ingestion_id": "ing_a",
                "timestamp": "2026-04-11T12:00:00Z",
            }
        )
        tools["database.upsert_signal"](
            {
                "signal_code": "order_missing_in_documents",
                "entity_ref": "order_2",
                "ingestion_id": "ing_b",
                "timestamp": "2026-04-11T10:00:00Z",
            }
        )
        digest = build_digest(sig_conn)
        digest_order = [(s["signal_code"], s["entity_ref"]) for s in digest["summary"]["signals"]]

        sent = _seed_pending(
            db_path,
            send_impl=lambda _: {"status": "ok"},
            mcp_execute=lambda _t, _p: {"status": "ok"},
            dispatch_stub=lambda actions: actions,
            digest=digest,
        )

        rows = _fetch_pending_positions(db_path)
        db_order = [(signal_code, entity_ref) for _, signal_code, entity_ref in rows]

        assert len(sent) == 1
        message = sent[0]
        message_pairs: list[tuple[str, str]] = []
        for line in message.splitlines():
            clean = line.strip()
            if ") " not in clean or " en " not in clean:
                continue
            left = clean.split(") ", 1)[1]
            parts = left.split(" en ", 1)
            if len(parts) == 2:
                message_pairs.append((parts[0], parts[1]))

        assert db_order == digest_order
        assert message_pairs == digest_order
    finally:
        _cleanup_db_path(db_path)


def test_numbering_consistency_position_matches_message() -> None:
    db_path = _new_db_path()
    try:
        sent = _seed_pending(
            db_path,
            send_impl=lambda _: {"status": "ok"},
            mcp_execute=lambda _t, _p: {"status": "ok"},
            dispatch_stub=lambda actions: actions,
            digest=DIGEST_GROUPED,
        )

        rows = _fetch_pending_positions(db_path)
        expected = {position: (signal_code, entity_ref) for position, signal_code, entity_ref in rows}

        message = sent[0]
        found: dict[int, tuple[str, str]] = {}
        for line in message.splitlines():
            clean = line.strip()
            if ") " not in clean or " en " not in clean:
                continue
            num_part, rest = clean.split(") ", 1)
            if not num_part.isdigit():
                continue
            pair = rest.split(" en ", 1)
            if len(pair) != 2:
                continue
            found[int(num_part)] = (pair[0], pair[1])

        assert found == expected
        assert "[orders]" in message
        assert "[other]" in message
    finally:
        _cleanup_db_path(db_path)


def test_invalid_index_is_ignored() -> None:
    db_path = _new_db_path()
    try:
        dispatch_calls: list[list[dict]] = []

        _seed_pending(
            db_path,
            send_impl=lambda _: {"status": "ok"},
            mcp_execute=lambda _t, _p: {"status": "ok"},
            dispatch_stub=lambda actions: dispatch_calls.append(actions) or actions,
            digest=DIGEST_GROUPED,
        )

        out = loop.handle_telegram_update({"message": {"message_id": 9001, "text": "99"}})
        assert out["status"] == "ignored"
        assert len(dispatch_calls) == 0
        assert _count_consumed(db_path) == 0
    finally:
        _cleanup_db_path(db_path)


def test_duplicate_message_id_processed_once() -> None:
    db_path = _new_db_path()
    try:
        dispatch_calls: list[list[dict]] = []

        _seed_pending(
            db_path,
            send_impl=lambda _: {"status": "ok"},
            mcp_execute=lambda _t, _p: {"status": "ok"},
            dispatch_stub=lambda actions: dispatch_calls.append(actions) or actions,
            digest=DIGEST_GROUPED,
        )

        msg = {"message": {"message_id": "dup-1", "text": "1"}}
        out1 = loop.handle_telegram_update(msg)
        out2 = loop.handle_telegram_update(msg)

        assert out1["status"] == "ok"
        assert out2["status"] == "ignored"
        assert len(dispatch_calls) == 1
        assert _count_processed_messages(db_path) == 1
    finally:
        _cleanup_db_path(db_path)


def test_transaction_integrity_on_failure() -> None:
    db_path = _new_db_path()
    try:
        dispatch_calls: list[list[dict]] = []

        def failing_mcp(_tool: str, _payload: dict) -> dict:
            raise RuntimeError("simulated logs.write failure")

        _seed_pending(
            db_path,
            send_impl=lambda _: {"status": "ok"},
            mcp_execute=failing_mcp,
            dispatch_stub=lambda actions: dispatch_calls.append(actions) or actions,
            digest=DIGEST_GROUPED,
        )

        try:
            loop.handle_telegram_update({"message": {"message_id": "tx-1", "text": "1"}})
            assert False, "Expected RuntimeError"
        except RuntimeError as exc:
            assert "simulated logs.write failure" in str(exc)

        assert len(dispatch_calls) == 1
        assert _count_consumed(db_path) == 0
        assert _count_processed_messages(db_path) == 0
    finally:
        _cleanup_db_path(db_path)


if __name__ == "__main__":
    test_ordering_integrity_digest_db_message()
    test_numbering_consistency_position_matches_message()
    test_invalid_index_is_ignored()
    test_duplicate_message_id_processed_once()
    test_transaction_integrity_on_failure()
    print("ok")


