"""
app/services/orchestrator/run_pipeline.py
------------------------------------------
Pure coordinator. No business logic. No data transformation.
Connects existing pipeline components in the canonical order:

    signals_engine → global_signals → batch_processor
"""

from __future__ import annotations

import time

import app.services.signals.batch_processor as batch_processor
import signals_engine
from app.services.observability.logger import get_logger
from app.services.signals.global_signals import compute_signal_lifecycle
from app.services.signals.batch_processor import process_signal_batch

logger = get_logger(__name__)


def run_pipeline(
    findings: list[dict],
    tenant_id: str,
    source_module: str,
    ingestion_id: str,
    correlation_id: str,
    timestamp: str,
    previous_signals: list[dict],
) -> dict:
    """
    Execute the signal pipeline end-to-end.

    Parameters
    ----------
    findings         : raw findings from findings_engine.build_findings()
    tenant_id        : tenant identifier — required, no silent default
    source_module    : module identifier (e.g. "reconciliation")
    ingestion_id     : unique id for this ingestion run
    correlation_id   : tracing id for this batch
    timestamp        : ISO 8601 string; passed as created_at to signals_engine
    previous_signals : signals from the prior lifecycle cycle (may be [])

    Returns
    -------
    {
        "signals"      : list — current signals enriched with lifecycle status,
        "lifecycle"    : dict — {"open": [...], "persisting": [...], "resolved": [...]},
        "batch_result" : dict — output from batch_processor
    }
    """
    if not tenant_id or not tenant_id.strip():
        raise ValueError("tenant_id is required")

    pipeline_started_at = time.time()
    logger.info(
        {
            "event": "pipeline_start",
            "ingestion_id": ingestion_id,
            "tenant_id": tenant_id,
            "module": source_module,
        }
    )

    # Step 1 — findings → canonical signals (signals_engine is the adapter)
    current_signals = signals_engine.build_signals(
        findings=findings,
        tenant_id=tenant_id,
        module=source_module,
        created_at=timestamp,
    )

    # Step 1b — deduplicate by identity keys before lifecycle
    # global_signal_id is derived from (signal_code, entity_ref, source_module),
    # so deduplicating by those three fields is equivalent and safe at this stage.
    _seen: dict[tuple, dict] = {}
    for s in current_signals:
        key = (s.get("signal_code"), s.get("entity_ref"), s.get("source_module"))
        _seen[key] = s
    current_signals = list(_seen.values())

    # Step 2 — lifecycle classification (open / persisting / resolved)
    lifecycle_result = compute_signal_lifecycle(
        previous_signals=previous_signals,
        current_signals=current_signals,
    )

    # Step 3 — enrich each signal with tenant_id, then persist + dispatch
    signals_with_tenant = [
        {**s, "tenant_id": tenant_id} for s in lifecycle_result["current"]
    ]

    batch_result = process_signal_batch(
        signals=signals_with_tenant,
        tenant_id=tenant_id,
        ingestion_id=ingestion_id,
        correlation_id=correlation_id,
        timestamp=timestamp,
    )

    # Step 4 — close resolved signals
    for signal in lifecycle_result["lifecycle"]["resolved"]:
        batch_processor.mcp_execute(
            "database.close_signal",
            {
                "tenant_id": tenant_id,
                "signal_code": signal["signal_code"],
                "entity_ref": signal["entity_ref"],
                "ingestion_id": ingestion_id,
                "timestamp": timestamp,
            },
        )

    logger.info(
        {
            "event": "pipeline_end",
            "ingestion_id": ingestion_id,
            "tenant_id": tenant_id,
            "module": source_module,
            "signals": len(lifecycle_result["current"]),
            "open": len(lifecycle_result["lifecycle"]["open"]),
            "persisting": len(lifecycle_result["lifecycle"]["persisting"]),
            "resolved": len(lifecycle_result["lifecycle"]["resolved"]),
            "pipeline_duration_sec": round(time.time() - pipeline_started_at, 6),
        }
    )

    return {
        "signals": lifecycle_result["current"],
        "lifecycle": lifecycle_result["lifecycle"],
        "batch_result": batch_result,
    }
