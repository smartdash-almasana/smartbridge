"""
Integration tests for clarification persistence and blocking behavior.
"""
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import clarification_service as cs
from app.run_pipeline import run_pipeline


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch):
    """Use a temporary DB for each test."""
    test_db = tmp_path / "clarifications.db"
    monkeypatch.setattr(cs, "_DB_PATH", test_db)
    yield test_db


# ---------------------------------------------------------------------------
# Unit: clarification service
# ---------------------------------------------------------------------------

def test_save_clarifications_inserts_records(isolated_db):
    uncertainties = [
        {"value_a": "prod x", "value_b": "prod y", "similarity": 0.82},
        {"value_a": "item a", "value_b": "item b", "similarity": 0.78},
    ]
    ids = cs.save_clarifications(uncertainties)
    assert len(ids) == 2

    pending = cs.get_pending_clarifications()
    assert len(pending) == 2
    assert pending[0]["value_a"] == "prod x"
    assert pending[1]["value_a"] == "item a"


def test_get_pending_clarifications_returns_only_unresolved(isolated_db):
    cs.save_clarifications([{"value_a": "a", "value_b": "b", "similarity": 0.9}])
    cs.save_clarifications([{"value_a": "c", "value_b": "d", "similarity": 0.8}])

    # Resolve the first one (most recent due to DESC ordering)
    pending = cs.get_pending_clarifications()
    cs.resolve_clarification(pending[0]["id"], "accepted")

    pending = cs.get_pending_clarifications()
    assert len(pending) == 1
    # The remaining one is the older one ("a")
    assert pending[0]["value_a"] == "a"


def test_resolve_clarification_updates_record(isolated_db):
    ids = cs.save_clarifications([{"value_a": "x", "value_b": "y", "similarity": 0.75}])
    result = cs.resolve_clarification(ids[0], "rejected")
    assert result is True

    pending = cs.get_pending_clarifications()
    assert len(pending) == 0


def test_has_pending_clarifications_returns_correct_status(isolated_db):
    assert cs.has_pending_clarifications() is False

    cs.save_clarifications([{"value_a": "a", "value_b": "b", "similarity": 0.9}])
    assert cs.has_pending_clarifications() is True

    pending = cs.get_pending_clarifications()
    cs.resolve_clarification(pending[0]["id"], "accepted")
    assert cs.has_pending_clarifications() is False


# ---------------------------------------------------------------------------
# Integration: pipeline blocking on uncertainties
# ---------------------------------------------------------------------------

def test_pipeline_blocked_saves_clarifications(isolated_db):
    mock_result = {
        "status": "blocked",
        "uncertainties": [
            {"value_a": "prod x", "value_b": "prod y", "similarity": 0.82, "requires_validation": True}
        ],
    }
    with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=mock_result):
        with patch("app.run_pipeline.has_pending_clarifications", return_value=False):
            result = run_pipeline(
                tenant_id="t1",
                file_a="a.xlsx",
                file_b="b.xlsx",
                ingestion_id="ing_123",
                correlation_id="corr_456",
                timestamp="2026-01-01T00:00:00Z",
            )

    assert result["status"] == "blocked"
    pending = cs.get_pending_clarifications()
    assert len(pending) == 1
    assert pending[0]["value_a"] == "prod x"


def test_pipeline_blocked_on_pending_clarifications(isolated_db):
    # Insert a pending clarification
    cs.save_clarifications([{"value_a": "old", "value_b": "new", "similarity": 0.85}])

    # Even if smartcounter would return OK, pipeline must block
    mock_result = {
        "status": "ok",
        "findings": [{"entity_name": "prod", "difference": 1, "source_a": {}, "source_b": {}}],
    }
    with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=mock_result):
        result = run_pipeline(
            tenant_id="t1",
            file_a="a.xlsx",
            file_b="b.xlsx",
            ingestion_id="ing_123",
            correlation_id="corr_456",
            timestamp="2026-01-01T00:00:00Z",
        )

    assert result["status"] == "blocked"
    assert result["reason"] == "pending_clarifications"


def test_pipeline_continues_after_clarifications_resolved(isolated_db):
    # Insert and then resolve a clarification
    ids = cs.save_clarifications([{"value_a": "old", "value_b": "new", "similarity": 0.85}])
    cs.resolve_clarification(ids[0], "accepted")

    mock_result = {
        "status": "ok",
        "findings": [{"entity_name": "prod", "difference": 1, "source_a": {}, "source_b": {}}],
    }
    mock_orchestrator_result = {
        "signals": [],
        "lifecycle": {"open": [], "persisting": [], "resolved": []},
        "batch_result": {"batch_status": "success", "processed": 0, "failed": 0},
    }
    with patch("app.run_pipeline.smartcounter_run_pipeline", return_value=mock_result):
        with patch("app.run_pipeline.orchestrator_run", return_value=mock_orchestrator_result):
            result = run_pipeline(
                tenant_id="t1",
                file_a="a.xlsx",
                file_b="b.xlsx",
                ingestion_id="ing_123",
                correlation_id="corr_456",
                timestamp="2026-01-01T00:00:00Z",
            )

    assert result["status"] == "ok"
    assert "signals" in result