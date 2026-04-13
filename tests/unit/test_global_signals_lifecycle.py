from copy import deepcopy

from app.services.signals.global_signals import (
    build_global_signal_id,
    compute_signal_lifecycle,
)


def _signal(signal_code: str, entity_ref: str, source_module: str = "reconciliation") -> dict:
    return {
        "signal_code": signal_code,
        "entity_ref": entity_ref,
        "source_module": source_module,
        "severity": "high",
        "created_at": "2026-01-01T00:00:00Z",
    }


def test_build_global_signal_id_is_deterministic_and_ignores_volatile_fields() -> None:
    a = _signal("order_mismatch", "order_1")
    b = {**_signal("order_mismatch", "order_1"), "severity": "low", "created_at": "2026-02-01T00:00:00Z"}

    assert build_global_signal_id(a) == build_global_signal_id(b)


def test_build_global_signal_id_rejects_invalid_identity_fields() -> None:
    bad = _signal("order_mismatch", "order_1")
    bad["entity_ref"] = "  "
    try:
        build_global_signal_id(bad)
        assert False, "Expected ValueError"
    except ValueError as exc:
        assert "entity_ref" in str(exc)


def test_compute_signal_lifecycle_classifies_open_persisting_resolved() -> None:
    prev_current = compute_signal_lifecycle([], [_signal("order_mismatch", "order_1"), _signal("order_mismatch", "order_2")])["current"]
    current = [_signal("order_mismatch", "order_2"), _signal("order_missing_in_documents", "order_3")]

    result = compute_signal_lifecycle(prev_current, current)

    assert [s["entity_ref"] for s in result["lifecycle"]["open"]] == ["order_3"]
    assert [s["entity_ref"] for s in result["lifecycle"]["persisting"]] == ["order_2"]
    assert [s["entity_ref"] for s in result["lifecycle"]["resolved"]] == ["order_1"]
    assert [s["status"] for s in result["current"]] == ["persisting", "open"]


def test_compute_signal_lifecycle_does_not_mutate_inputs() -> None:
    previous = compute_signal_lifecycle([], [_signal("order_mismatch", "order_1")])["current"]
    current = [_signal("order_mismatch", "order_1")]
    previous_before = deepcopy(previous)
    current_before = deepcopy(current)

    compute_signal_lifecycle(previous, current)

    assert previous == previous_before
    assert current == current_before


def test_compute_signal_lifecycle_rejects_duplicate_or_invalid_previous_entries() -> None:
    bad_previous = [
        {"global_signal_id": "gsi_same", "signal_code": "order_mismatch", "entity_ref": "order_1", "source_module": "reconciliation"},
        {"global_signal_id": "gsi_same", "signal_code": "order_mismatch", "entity_ref": "order_1", "source_module": "reconciliation"},
    ]
    try:
        compute_signal_lifecycle(bad_previous, [])
        assert False, "Expected ValueError on duplicate global_signal_id"
    except ValueError as exc:
        assert "Duplicate 'global_signal_id'" in str(exc)

