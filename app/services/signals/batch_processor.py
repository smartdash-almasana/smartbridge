from typing import Any
import time

from app.services.action_engine.from_signals import execute_action_from_signal
from app.services.observability.logger import get_logger


mcp_execute = None
dispatch = lambda signal, ingestion_id, correlation_id: execute_action_from_signal(signal)
logger = get_logger(__name__)


def _require_non_empty_str(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Field '{field_name}' is required and must be a non-empty string.")
    return value.strip()


def process_signal_batch(
    signals: list[dict[str, Any]],
    tenant_id: str,
    ingestion_id: str,
    correlation_id: str,
    timestamp: str,
) -> dict[str, Any]:
    _require_non_empty_str(tenant_id, "tenant_id")
    _require_non_empty_str(ingestion_id, "ingestion_id")
    _require_non_empty_str(correlation_id, "correlation_id")
    _require_non_empty_str(timestamp, "timestamp")

    if not isinstance(signals, list):
        raise ValueError("'signals' must be a list.")

    if mcp_execute is None:
        raise ValueError("mcp_execute is not configured.")

    batch_started_at = time.time()
    logger.info(
        {
            "event": "batch_start",
            "ingestion_id": ingestion_id,
            "tenant_id": tenant_id,
            "module": __name__,
        }
    )

    ordered_signals = sorted(
        signals,
        key=lambda s: (
            str(s.get("signal_code") if isinstance(s, dict) else ""),
            str(s.get("entity_ref") if isinstance(s, dict) else ""),
        ),
    )

    processed_count = 0
    failed_count = 0

    for signal in ordered_signals:
        if not isinstance(signal, dict):
            failed_count = 1
            logger.info(
                {
                    "event": "batch_end",
                    "ingestion_id": ingestion_id,
                    "module": __name__,
                    "processed": processed_count,
                    "failed": failed_count,
                    "batch_duration_sec": round(time.time() - batch_started_at, 6),
                }
            )
            return {
                "batch_status": "failed",
                "processed": processed_count,
                "failed": failed_count,
            }

        signal_code = _require_non_empty_str(signal.get("signal_code"), "signal_code")
        entity_ref = _require_non_empty_str(signal.get("entity_ref"), "entity_ref")

        try:
            mcp_execute(
                "database.upsert_signal",
                {
                    "tenant_id": tenant_id,
                    "signal_code": signal_code,
                    "entity_ref": entity_ref,
                    "ingestion_id": ingestion_id,
                    "timestamp": timestamp,
                },
            )
            if dispatch is not None:
                result = dispatch(signal, ingestion_id, correlation_id)
            else:
                result = execute_action_from_signal(signal)
            mcp_execute(
                "database.persist_action",
                {
                    "tenant_id": tenant_id,
                    "signal_code": result["signal_code"],
                    "entity_ref": result["entity_ref"],
                    "action_type": result["action_type"],
                    "status": result["status"],
                    "ingestion_id": ingestion_id,
                    "correlation_id": correlation_id,
                    "created_at": timestamp,
                },
            )
            processed_count += 1
        except Exception:
            failed_count = 1
            logger.info(
                {
                    "event": "batch_end",
                    "ingestion_id": ingestion_id,
                    "module": __name__,
                    "processed": processed_count,
                    "failed": failed_count,
                    "batch_duration_sec": round(time.time() - batch_started_at, 6),
                }
            )
            return {
                "batch_status": "failed",
                "processed": processed_count,
                "failed": failed_count,
            }

    logger.info(
        {
            "event": "batch_end",
            "ingestion_id": ingestion_id,
            "module": __name__,
            "processed": processed_count,
            "failed": failed_count,
            "batch_duration_sec": round(time.time() - batch_started_at, 6),
        }
    )

    return {
        "batch_status": "success",
        "processed": processed_count,
        "failed": failed_count,
    }
