from copy import deepcopy

import pytest

from app.services.action_engine.dispatcher import dispatch_actions
from app.services.action_engine.from_signals import build_action_jobs_from_signals, execute_action_from_signal


def _open_signal(
    global_signal_id: str,
    signal_code: str,
    entity_ref: str,
    priority_score: int,
) -> dict:
    return {
        "global_signal_id": global_signal_id,
        "signal_code": signal_code,
        "entity_ref": entity_ref,
        "source_module": "reconciliation",
        "priority_score": priority_score,
        "status": "open",
    }


def test_build_action_jobs_from_signals_core_sort_and_determinism() -> None:
    lifecycle = {
        "lifecycle": {
            "open": [
                _open_signal("gsi_b", "order_mismatch", "order_2", 90),
                _open_signal("gsi_a", "order_mismatch", "order_1", 90),
                _open_signal("gsi_c", "order_missing_in_documents", "order_3", 70),
            ],
            "persisting": [],
            "resolved": [],
        }
    }

    first = build_action_jobs_from_signals(lifecycle, tenant_id="tenant_1")
    second = build_action_jobs_from_signals(lifecycle, tenant_id="tenant_1")

    assert first == second
    assert [a["priority_score"] for a in first] == [90, 90, 70]
    assert first[0]["action_id"] < first[1]["action_id"]
    assert all(a["status"] == "pending" for a in first)


@pytest.mark.parametrize(
    "bad_lifecycle",
    [
        {},
        {"lifecycle": []},
        {"lifecycle": {"open": "not-list"}},
    ],
)
def test_build_action_jobs_from_signals_rejects_invalid_lifecycle_shape(bad_lifecycle: dict) -> None:
    with pytest.raises(ValueError):
        build_action_jobs_from_signals(bad_lifecycle, tenant_id="tenant_1")


def test_build_action_jobs_from_signals_rejects_invalid_open_signal() -> None:
    lifecycle = {"lifecycle": {"open": [{"signal_code": "order_mismatch"}]}}
    with pytest.raises(ValueError):
        build_action_jobs_from_signals(lifecycle, tenant_id="tenant_1")


def test_execute_action_from_signal_validates_required_fields() -> None:
    with pytest.raises(ValueError):
        execute_action_from_signal({"signal_code": "", "entity_ref": "order_1"})
    with pytest.raises(ValueError):
        execute_action_from_signal({"signal_code": "order_mismatch", "entity_ref": ""})


def test_dispatch_actions_executes_pending_and_preserves_non_pending_without_mutation() -> None:
    actions = [
        {
            "action_id": "act_1",
            "action_type": "review_order",
            "entity_ref": "order_1",
            "status": "pending",
        },
        {
            "action_id": "act_2",
            "action_type": "request_document",
            "entity_ref": "order_2",
            "status": "completed",
        },
    ]
    before = deepcopy(actions)

    out = dispatch_actions(actions)

    assert actions == before
    assert out[0]["status"] == "completed"
    assert out[0]["execution_result"]["success"] is True
    assert out[1] == before[1]


def test_dispatch_actions_rejects_invalid_inputs() -> None:
    with pytest.raises(ValueError):
        dispatch_actions("bad")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        dispatch_actions([{"action_id": "a1", "action_type": "unknown"}])

