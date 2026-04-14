"""
Integration tests: smartcounter_core pipeline → signals adapter bridge.
Does NOT touch action_engine, batch_processor, or lifecycle tables.
"""
from unittest.mock import patch, MagicMock
import pytest

from app.services.smartcounter_adapter import findings_to_signals
from app.run_pipeline import run_pipeline


# ---------------------------------------------------------------------------
# Unit: adapter mapping
# ---------------------------------------------------------------------------

def test_findings_to_signals_maps_fields():
    findings = [
        {
            "entity_name": "aceite girasol",
            "difference": -5,
            "source_a": {"product_name": "aceite girasol", "quantity": 10},
            "source_b": {"product_name": "aceite girasol", "quantity": 15},
        }
    ]
    signals = findings_to_signals(findings)
    assert len(signals) == 1
    s = signals[0]
    assert s["type"] == "stock_mismatch_detected"
    assert s["entity_ref"] == "aceite girasol"
    assert s["payload"]["difference"] == -5
    assert s["payload"]["source_a"]["quantity"] == 10
    assert s["payload"]["source_b"]["quantity"] == 15


def test_findings_to_signals_empty():
    assert findings_to_signals([]) == []


# ---------------------------------------------------------------------------
# Integration: pipeline OK → orchestrator_run called → batch_result present
# ---------------------------------------------------------------------------

def test_pipeline_ok_calls_orchestrator_run_and_returns_batch_result():
    mock_smartcounter_result = {
        "status": "ok",
        "findings": [
            {
                "entity_name": "producto A",
                "difference": 3,
                "source_a": {"product_name": "producto A", "quantity": 8},
                "source_b": {"product_name": "producto A", "quantity": 5},
            }
        ],
    }
    mock_orchestrator_result = {
        "signals": [{"signal_code": "stock_mismatch_detected", "entity_ref": "producto A"}],
        "lifecycle": {"open": [], "persisting": [], "resolved": []},
        "batch_result": {"batch_status": "success", "processed": 1, "failed": 0},
    }

    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=mock_smartcounter_result):
            with patch("app.run_pipeline.orchestrator_run") as mock_orch:
                mock_orch.return_value = mock_orchestrator_result
                result = run_pipeline(
                    tenant_id="t1",
                    file_a="a.xlsx",
                    file_b="b.xlsx",
                    ingestion_id="ing_123",
                    correlation_id="corr_456",
                    timestamp="2026-01-01T00:00:00Z",
                )

    mock_orch.assert_called_once()
    call_kwargs = mock_orch.call_args.kwargs
    assert call_kwargs["tenant_id"] == "t1"
    assert call_kwargs["source_module"] == "smartcounter"
    assert call_kwargs["ingestion_id"] == "ing_123"
    assert len(call_kwargs["findings"]) == 1
    assert call_kwargs["findings"][0]["type"] == "stock_mismatch_detected"
    assert result["status"] == "ok"
    assert result["signals"][0]["signal_code"] == "stock_mismatch_detected"
    assert "batch_result" in result
    assert result["batch_result"] is not None
    assert result["batch_result"]["batch_status"] == "success"


# ---------------------------------------------------------------------------
# Integration: process_signal_batch called with correct signal_code + entity_ref
# ---------------------------------------------------------------------------

def test_pipeline_ok_process_signal_batch_called_with_correct_fields():
    mock_smartcounter_result = {
        "status": "ok",
        "findings": [
            {
                "entity_name": "producto_B",
                "difference": 2,
                "source_a": {"product_name": "producto B", "quantity": 5},
                "source_b": {"product_name": "producto B", "quantity": 3},
            }
        ],
    }

    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=mock_smartcounter_result):
            with patch("app.services.orchestrator.run_pipeline.process_signal_batch") as mock_batch:
                mock_batch.return_value = {"batch_status": "success", "processed": 1, "failed": 0}
                result = run_pipeline(
                    tenant_id="t1",
                    file_a="a.xlsx",
                    file_b="b.xlsx",
                    ingestion_id="ing_456",
                    correlation_id="corr_789",
                    timestamp="2026-01-01T00:00:00Z",
                )

    mock_batch.assert_called_once()
    call_kwargs = mock_batch.call_args.kwargs
    assert call_kwargs["tenant_id"] == "t1"
    assert call_kwargs["ingestion_id"] == "ing_456"
    assert len(call_kwargs["signals"]) == 1
    signal = call_kwargs["signals"][0]
    assert signal["signal_code"] == "stock_mismatch_detected"
    assert signal["entity_ref"] == "producto_B"
    assert result["batch_result"]["batch_status"] == "success"


# ---------------------------------------------------------------------------
# Integration: pipeline blocked → orchestrator_run NOT called
# ---------------------------------------------------------------------------

def test_pipeline_blocked_does_not_call_orchestrator():
    mock_result = {
        "status": "blocked",
        "uncertainties": [
            {"value_a": "prod x", "value_b": "prod y", "similarity": 0.82, "requires_validation": True}
        ],
    }
    with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
        with patch("app.run_pipeline.save_clarifications"):
            with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=mock_result):
                with patch("app.run_pipeline.orchestrator_run") as mock_orch:
                    result = run_pipeline(
                        tenant_id="t1",
                        file_a="a.xlsx",
                        file_b="b.xlsx",
                        ingestion_id="ing_123",
                        correlation_id="corr_456",
                        timestamp="2026-01-01T00:00:00Z",
                    )

    mock_orch.assert_not_called()
    assert result["status"] == "blocked"
    assert "signals" not in result
    assert "batch_result" not in result
    assert "uncertainties" in result


# ---------------------------------------------------------------------------
# Stub path: no files provided → original stub behaviour preserved
# ---------------------------------------------------------------------------

def test_pipeline_stub_when_no_files():
    result = run_pipeline(tenant_id="t1")
    assert result["status"] == "ok"
    assert result["message"] == "pipeline stub running"
