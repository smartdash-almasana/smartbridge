import hashlib
import json
import os
import sqlite3
from typing import Any, Callable
from urllib import request

from app.services.action_engine.dispatcher import dispatch_actions
from app.services.action_engine.from_signals import SIGNAL_CODE_TO_ACTION_TYPE
from app.services.digest.build_grouped_digest import build_grouped_digest
from app.services.digest.grouping import resolve_signal_group


_mcp_execute: Callable[[str, dict[str, Any]], Any] | None = None
_send_impl: Callable[[str], Any] | None = None

_SUGGESTED_ACTION_BY_SIGNAL: dict[str, str] = {
    "order_mismatch": "Revisar inconsistencia en la orden.",
    "order_missing_in_documents": "Solicitar documentación faltante.",
    "duplicate_order": "Verificar posible duplicado de orden.",
}


def _get_db_path() -> str:
    configured = os.getenv("TELEGRAM_LOOP_DB_PATH", "").strip()
    return configured if configured else "telegram_loop.sqlite3"


def _connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(_get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_pending_actions_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_id TEXT UNIQUE,
            signal_code TEXT,
            entity_ref TEXT,
            ingestion_id TEXT,
            correlation_id TEXT,
            created_at TEXT,
            position INTEGER,
            is_consumed INTEGER DEFAULT 0
        )
        """
    )

    columns = {
        str(row["name"]) for row in conn.execute("PRAGMA table_info(pending_actions)").fetchall()
    }
    if "position" not in columns:
        conn.execute("ALTER TABLE pending_actions ADD COLUMN position INTEGER")


def _ensure_processed_messages_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS processed_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT UNIQUE,
            created_at TEXT
        )
        """
    )


def _ensure_tables(conn: sqlite3.Connection) -> None:
    _ensure_pending_actions_schema(conn)
    _ensure_processed_messages_schema(conn)
    conn.commit()


def _build_deterministic_action_id(signal_code: str, entity_ref: str, index: int) -> str:
    canonical = json.dumps(
        {
            "signal_code": signal_code,
            "entity_ref": entity_ref,
            "index": index,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"act_{digest[:24]}"


def _build_actions_from_digest(digest: dict[str, Any]) -> list[dict[str, str]]:
    summary = digest.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("digest['summary'] must be a dict.")

    signals = summary.get("signals")
    if not isinstance(signals, list):
        raise ValueError("digest['summary']['signals'] must be a list.")

    actions: list[dict[str, str]] = []
    for idx, signal in enumerate(signals, start=1):
        if not isinstance(signal, dict):
            raise ValueError(f"digest['summary']['signals'][{idx - 1}] must be a dict.")

        signal_code = signal.get("signal_code")
        entity_ref = signal.get("entity_ref")
        if not isinstance(signal_code, str) or not signal_code.strip():
            raise ValueError(f"signal_code at index {idx - 1} must be a non-empty string.")
        if not isinstance(entity_ref, str) or not entity_ref.strip():
            raise ValueError(f"entity_ref at index {idx - 1} must be a non-empty string.")

        signal_code_clean = signal_code.strip()
        entity_ref_clean = entity_ref.strip()

        actions.append(
            {
                "action_id": _build_deterministic_action_id(signal_code_clean, entity_ref_clean, idx),
                "signal_code": signal_code_clean,
                "entity_ref": entity_ref_clean,
                "suggested_action": _SUGGESTED_ACTION_BY_SIGNAL.get(signal_code_clean, "Revisar señal detectada."),
            }
        )

    return actions


def _save_pending_actions(
    actions: list[dict[str, str]],
    ingestion_id: str,
    correlation_id: str,
    created_at: str,
) -> None:
    with _connect_db() as conn:
        _ensure_tables(conn)
        conn.executemany(
            """
            INSERT OR REPLACE INTO pending_actions (
                action_id,
                signal_code,
                entity_ref,
                ingestion_id,
                correlation_id,
                created_at,
                position,
                is_consumed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            """,
            [
                (
                    action["action_id"],
                    action["signal_code"],
                    action["entity_ref"],
                    ingestion_id,
                    correlation_id,
                    created_at,
                    idx,
                )
                for idx, action in enumerate(actions, start=1)
            ],
        )
        conn.commit()


def _get_latest_pending_actions(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    latest = conn.execute(
        """
        SELECT created_at
        FROM pending_actions
        WHERE is_consumed = 0
        ORDER BY created_at DESC
        LIMIT 1
        """
    ).fetchone()

    if latest is None:
        return []

    created_at = str(latest["created_at"])
    rows = conn.execute(
        """
        SELECT *
        FROM pending_actions
        WHERE is_consumed = 0 AND created_at = ?
        ORDER BY position ASC
        """,
        (created_at,),
    ).fetchall()
    return rows


def _get_pending_actions_by_created_at(conn: sqlite3.Connection, created_at: str) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT *
        FROM pending_actions
        WHERE is_consumed = 0 AND created_at = ?
        ORDER BY position ASC
        """,
        (created_at,),
    ).fetchall()


def _build_grouped_message_from_rows(rows: list[sqlite3.Row]) -> str:
    digest_like = {
        "summary": {
            "signals": [
                {
                    "position": int(row["position"]),
                    "signal_code": str(row["signal_code"]),
                    "entity_ref": str(row["entity_ref"]),
                    "group": resolve_signal_group(str(row["signal_code"])),
                }
                for row in rows
            ]
        }
    }
    grouped = build_grouped_digest(digest_like)

    lines: list[str] = []
    for group_entry in grouped["groups"]:
        group_name = str(group_entry["group"])
        lines.append(f"[{group_name}]")
        for signal in group_entry["signals"]:
            lines.append(
                f"{int(signal['position'])}) {str(signal['signal_code'])} en {str(signal['entity_ref'])}"
            )
        lines.append("")

    body = "\n".join(lines).strip()
    return (
        f"Tenés {len(rows)} alertas activas:\n\n"
        f"{body}\n\n"
        "Respondé con el número (ej: 1) o NO"
    )


def _mark_batch_consumed(conn: sqlite3.Connection, created_at: str) -> None:
    conn.execute(
        """
        UPDATE pending_actions
        SET is_consumed = 1
        WHERE is_consumed = 0 AND created_at = ?
        """,
        (created_at,),
    )


def _is_message_processed(conn: sqlite3.Connection, message_id: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM processed_messages
        WHERE message_id = ?
        LIMIT 1
        """,
        (message_id,),
    ).fetchone()
    return row is not None


def _register_processed_message(conn: sqlite3.Connection, message_id: str, created_at: str) -> None:
    conn.execute(
        """
        INSERT INTO processed_messages (message_id, created_at)
        VALUES (?, ?)
        """,
        (message_id, created_at),
    )


def configure_telegram_loop(
    mcp_execute: Callable[[str, dict[str, Any]], Any] | None = None,
    send_impl: Callable[[str], Any] | None = None,
) -> None:
    global _mcp_execute, _send_impl
    _mcp_execute = mcp_execute
    _send_impl = send_impl


def send_telegram_message(text: str) -> dict[str, Any]:
    if _send_impl is not None:
        result = _send_impl(text)
        if isinstance(result, dict):
            return result
        return {"status": "ok"}

    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token:
        raise ValueError("Missing TELEGRAM_BOT_TOKEN")
    if not chat_id:
        raise ValueError("Missing TELEGRAM_CHAT_ID")

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
    }
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url=url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with request.urlopen(req) as resp:
        response_body = resp.read().decode("utf-8")
        parsed = json.loads(response_body) if response_body else {}
        return parsed if isinstance(parsed, dict) else {"status": "ok"}


def send_digest_confirmation_request(
    digest: dict[str, Any],
    action: dict[str, Any],
    ingestion_id: str,
    correlation_id: str,
    timestamp: str,
) -> dict[str, Any]:
    _ = action
    actions = _build_actions_from_digest(digest)
    if not actions:
        send_telegram_message("Hoy no hay alertas activas.")
        return {"status": "ok"}

    _save_pending_actions(
        actions=actions,
        ingestion_id=ingestion_id,
        correlation_id=correlation_id,
        created_at=timestamp,
    )

    with _connect_db() as conn:
        _ensure_tables(conn)
        persisted = _get_pending_actions_by_created_at(conn, timestamp)

    message = _build_grouped_message_from_rows(persisted)
    send_telegram_message(message)
    return {"status": "ok"}


def handle_telegram_update(update: dict[str, Any]) -> dict[str, Any]:
    message = update.get("message")
    if not isinstance(message, dict):
        return {"status": "ignored"}

    message_id_raw = message.get("message_id")
    if not isinstance(message_id_raw, (int, str)):
        return {"status": "ignored"}
    message_id = str(message_id_raw)

    text = message.get("text")
    if not isinstance(text, str):
        return {"status": "ignored"}
    normalized = text.strip().upper()

    message_created_at_raw = message.get("date")
    message_created_at = str(message_created_at_raw) if isinstance(message_created_at_raw, (int, str)) else ""

    selected_number_for_response: int | None = None
    should_send_executed = False
    should_send_cancelled = False

    with _connect_db() as conn:
        _ensure_tables(conn)
        conn.execute("BEGIN")
        try:
            if _is_message_processed(conn, message_id):
                conn.commit()
                return {"status": "ignored"}

            _register_processed_message(conn, message_id, message_created_at)

            pending_actions = _get_latest_pending_actions(conn)
            if not pending_actions:
                conn.commit()
                return {"status": "ignored"}

            created_at = str(pending_actions[0]["created_at"])

            if normalized == "NO":
                _mark_batch_consumed(conn, created_at)
                conn.commit()
                should_send_cancelled = True
            else:
                if not normalized.isdigit():
                    conn.commit()
                    return {"status": "ignored"}

                selected_number = int(normalized)
                total_actions = len(pending_actions)
                if selected_number < 1 or selected_number > total_actions:
                    conn.commit()
                    return {"status": "ignored"}

                selected = pending_actions[selected_number - 1]
                if int(selected["is_consumed"]) == 1:
                    conn.commit()
                    return {"status": "ignored"}

                if _mcp_execute is None:
                    raise ValueError("mcp_execute is not configured.")

                signal_code = str(selected["signal_code"])
                action_type = SIGNAL_CODE_TO_ACTION_TYPE.get(signal_code)
                if action_type is None:
                    raise ValueError(f"No action mapping found for signal_code '{signal_code}'.")

                action_payload = {
                    "action_id": str(selected["action_id"]),
                    "action_type": action_type,
                    "signal_code": signal_code,
                    "entity_ref": str(selected["entity_ref"]),
                    "status": "pending",
                }

                dispatch_actions([action_payload])
                _mcp_execute(
                    "logs.write",
                    {
                        "event": "action_selected",
                        "action_id": str(selected["action_id"]),
                        "selected_index": selected_number,
                        "total_actions": total_actions,
                        "correlation_id": str(selected["correlation_id"]),
                        "ingestion_id": str(selected["ingestion_id"]),
                        "timestamp": str(selected["created_at"]),
                    },
                )
                _mark_batch_consumed(conn, created_at)
                conn.commit()
                should_send_executed = True
                selected_number_for_response = selected_number
        except Exception:
            conn.rollback()
            raise

    if should_send_cancelled:
        send_telegram_message("Acciones canceladas.")
        return {"status": "ok", "message": "Acciones canceladas."}

    if should_send_executed and selected_number_for_response is not None:
        send_telegram_message(f"Acción {selected_number_for_response} ejecutada correctamente.")
        return {
            "status": "ok",
            "message": f"Acción {selected_number_for_response} ejecutada correctamente.",
        }

    return {"status": "ignored"}
