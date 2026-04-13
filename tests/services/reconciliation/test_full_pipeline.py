"""
tests/test_full_pipeline.py
----------------------------
End-to-end pipeline integration tests for SmartBridge.

Covers the full chain:
  events + documents
    → reconcile_orders (normalize → match → diff → signals)
    → build_reconciliation_module_payload
    → build_normalized_signals
    → compute_signal_lifecycle
    → build_action_jobs_from_signals

No mocks. No patching. Real functions only.
All tests are deterministic: same input → identical output on every run.
"""

import copy
import os

from app.services.reconciliation.module_adapter import build_reconciliation_module_payload
from app.services.normalized_signals.service import build_normalized_signals
from app.services.signals.global_signals import compute_signal_lifecycle
from app.services.action_engine.from_signals import build_action_jobs_from_signals

# ---------------------------------------------------------------------------
# Shared fixtures (inline data — no pytest fixtures)
# ---------------------------------------------------------------------------

INGESTION_ID = "ing_test_pipeline_001"
TENANT_ID = "demo001"


def _event(order_id, amount, status):
    return {"order_id": order_id, "total_amount": amount, "status": status}


def _document(order_id, amount, status):
    return {"order_id": order_id, "total_amount": amount, "status": status}


# ---------------------------------------------------------------------------
# TEST 1 — FULL PIPELINE DETERMINISM
# ---------------------------------------------------------------------------

def test_full_pipeline_determinism():
    """
    Running the full pipeline twice with identical inputs must produce
    byte-identical outputs. No randomness, no timestamps in logic.
    """
    events = [
        _event("100", 500.0, "paid"),
        _event("101", 200.0, "pending"),
        _event("102", 999.0, "paid"),    # missing in documents
    ]
    documents = [
        _document("100", 500.0, "paid"),
        _document("101", 250.0, "pending"),  # amount mismatch
        _document("103", 150.0, "cancelled"),  # missing in events
    ]

    def run():
        payload = build_reconciliation_module_payload(
            copy.deepcopy(events), copy.deepcopy(documents)
        )
        sigs = build_normalized_signals(payload, INGESTION_ID)
        lc = compute_signal_lifecycle([], sigs["signals"])
        actions = build_action_jobs_from_signals(lc, TENANT_ID)
        return payload, sigs, lc, actions

    previous_fixed = os.environ.get("FIXED_TIMESTAMP")
    os.environ["FIXED_TIMESTAMP"] = "2026-01-01T00:00:00Z"
    try:
        payload1, sigs1, lc1, actions1 = run()
        payload2, sigs2, lc2, actions2 = run()

        assert payload1["canonical_rows"] == payload2["canonical_rows"]
        assert payload1["findings"] == payload2["findings"]
        assert payload1["summary"] == payload2["summary"]
        assert sigs1 == sigs2
        assert lc1 == lc2
        assert actions1 == actions2
    finally:
        if previous_fixed is None:
            os.environ.pop("FIXED_TIMESTAMP", None)
        else:
            os.environ["FIXED_TIMESTAMP"] = previous_fixed


# ---------------------------------------------------------------------------
# TEST 2 — NO DUPLICATES ACROSS PIPELINE
# ---------------------------------------------------------------------------

def test_no_duplicate_signals_or_actions():
    """
    Signals and actions must be globally unique (no duplicate IDs).
    """
    events = [
        _event("200", 100.0, "paid"),
        _event("201", 200.0, "pending"),
    ]
    documents = [
        _document("200", 100.0, "paid"),
        _document("202", 300.0, "paid"),  # missing in events
    ]

    payload = build_reconciliation_module_payload(events, documents)
    sigs = build_normalized_signals(payload, INGESTION_ID)
    lc = compute_signal_lifecycle([], sigs["signals"])
    actions = build_action_jobs_from_signals(lc, TENANT_ID)

    signal_ids = [s["signal_id"] for s in sigs["signals"]]
    action_ids = [a["action_id"] for a in actions]

    assert len(signal_ids) == len(set(signal_ids)), "Duplicate signal_ids detected."
    assert len(action_ids) == len(set(action_ids)), "Duplicate action_ids detected."


# ---------------------------------------------------------------------------
# TEST 3 — SCENARIO: order in events, missing in documents → OPEN action
# ---------------------------------------------------------------------------

def test_scenario_missing_in_documents_produces_open_action():
    """
    Scenario 1:
    Order exists in events but has no matching document.
    Expected: signal type 'order_missing_in_documents', status 'open',
              action_type 'request_document'.
    """
    events = [_event("300", 500.0, "paid")]
    documents = []

    payload = build_reconciliation_module_payload(events, documents)
    sigs = build_normalized_signals(payload, INGESTION_ID)
    lc = compute_signal_lifecycle([], sigs["signals"])
    actions = build_action_jobs_from_signals(lc, TENANT_ID)

    assert len(actions) == 1
    action = actions[0]
    assert action["signal_code"] == "order_missing_in_documents"
    assert action["action_type"] == "request_document"
    assert action["status"] == "pending"
    assert action["tenant_id"] == TENANT_ID

    # Verify signal was open
    open_signal_codes = [s["signal_code"] for s in lc["lifecycle"]["open"]]
    assert "order_missing_in_documents" in open_signal_codes


# ---------------------------------------------------------------------------
# TEST 4 — SCENARIO: order resolved (appears in both runs)
# ---------------------------------------------------------------------------

def test_scenario_order_resolved_in_second_run():
    """
    Scenario 2:
    Run 1: order missing in documents → open signal.
    Run 2: document now exists → signal disappears → resolved.
    No action generated in run 2 for that signal.
    """
    events = [_event("400", 100.0, "paid")]
    documents_run1 = []
    documents_run2 = [_document("400", 100.0, "paid")]

    # Run 1
    payload1 = build_reconciliation_module_payload(events, copy.deepcopy(documents_run1))
    sigs1 = build_normalized_signals(payload1, "ing_run1")
    lc1 = compute_signal_lifecycle([], sigs1["signals"])

    assert len(lc1["lifecycle"]["open"]) >= 1

    # Run 2 — feed run1 signals as previous
    payload2 = build_reconciliation_module_payload(events, copy.deepcopy(documents_run2))
    sigs2 = build_normalized_signals(payload2, "ing_run2")
    # Pass enriched current from run1 as previous
    previous = lc1["current"]
    lc2 = compute_signal_lifecycle(previous, sigs2["signals"])

    # Signal for order_400 should now be resolved
    resolved_refs = [s["entity_ref"] for s in lc2["lifecycle"]["resolved"]]
    assert any("400" in ref for ref in resolved_refs)

    # No open actions for this order
    actions2 = build_action_jobs_from_signals(lc2, TENANT_ID)
    open_refs = [a["entity_ref"] for a in actions2]
    assert not any("400" in ref for ref in open_refs)


# ---------------------------------------------------------------------------
# TEST 5 — SCENARIO: mismatch persists across two runs
# ---------------------------------------------------------------------------

def test_scenario_mismatch_persists():
    """
    Scenario 3:
    Amount mismatch exists in run 1 and run 2.
    Signal must appear as 'persisting' in run 2 — not duplicated as open.
    """
    events = [_event("500", 999.0, "paid")]
    documents = [_document("500", 111.0, "paid")]  # amount mismatch

    def run(ingestion_id, previous):
        payload = build_reconciliation_module_payload(
            copy.deepcopy(events), copy.deepcopy(documents)
        )
        sigs = build_normalized_signals(payload, ingestion_id)
        return compute_signal_lifecycle(previous, sigs["signals"])

    lc1 = run("ing_r1", [])
    lc2 = run("ing_r2", lc1["current"])

    persisting_codes = [s["signal_code"] for s in lc2["lifecycle"]["persisting"]]
    open_codes = [s["signal_code"] for s in lc2["lifecycle"]["open"]]

    assert "order_mismatch" in persisting_codes
    assert "order_mismatch" not in open_codes

    # Only persisting — no action generated
    actions2 = build_action_jobs_from_signals(lc2, TENANT_ID)
    action_codes = [a["signal_code"] for a in actions2]
    assert "order_mismatch" not in action_codes


# ---------------------------------------------------------------------------
# TEST 6 — CORRECT ACTION MAPPING
# ---------------------------------------------------------------------------

def test_action_types_are_correctly_mapped():
    """
    Each signal_code must map to its specified action_type.
    """
    events = [
        _event("600", 100.0, "paid"),    # missing in docs → request_document
        _event("601", 100.0, "paid"),    # mismatch       → review_order
    ]
    documents = [
        _document("601", 999.0, "paid"),  # mismatch on 601
        _document("602", 50.0, "paid"),   # missing in events → check_event_flow
    ]

    payload = build_reconciliation_module_payload(events, documents)
    sigs = build_normalized_signals(payload, INGESTION_ID)
    lc = compute_signal_lifecycle([], sigs["signals"])
    actions = build_action_jobs_from_signals(lc, TENANT_ID)

    action_map = {a["signal_code"]: a["action_type"] for a in actions}

    assert action_map.get("order_missing_in_documents") == "request_document"
    assert action_map.get("order_mismatch") == "review_order"
    assert action_map.get("order_missing_in_events") == "check_event_flow"


# ---------------------------------------------------------------------------
# TEST 7 — CONSISTENT OUTPUT STRUCTURE
# ---------------------------------------------------------------------------

def test_pipeline_output_has_consistent_structure():
    """
    Every layer's output must carry the required structural keys.
    """
    events = [_event("700", 200.0, "paid")]
    documents = [_document("700", 200.0, "paid")]

    payload = build_reconciliation_module_payload(events, documents)
    sigs = build_normalized_signals(payload, INGESTION_ID)
    lc = compute_signal_lifecycle([], sigs["signals"])
    actions = build_action_jobs_from_signals(lc, TENANT_ID)

    # payload contract
    for key in ("tenant_id", "module", "canonical_rows", "findings", "summary", "suggested_actions"):
        assert key in payload, f"payload missing key: '{key}'"

    # signals contract
    assert "signals" in sigs
    assert "summary" in sigs
    for key in ("total_signals", "high_priority", "medium_priority", "low_priority"):
        assert key in sigs["summary"]

    # lifecycle contract
    assert "current" in lc
    assert "lifecycle" in lc
    for key in ("open", "persisting", "resolved"):
        assert key in lc["lifecycle"]

    # action contract
    required_action_keys = {
        "action_id", "tenant_id", "global_signal_id", "signal_code",
        "entity_ref", "action_type", "priority_score", "status",
        "created_at", "context",
    }
    for action in actions:
        missing = required_action_keys - set(action.keys())
        assert not missing, f"Action missing keys: {missing}"




