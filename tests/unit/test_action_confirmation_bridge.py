import pytest
from unittest.mock import patch

from app.services.action_confirmation_bridge import (
    draft_to_action_payload,
    execute_if_confirmed,
)


def test_confirmed_draft_to_action_payload_accepted() -> None:
    draft = {
        "draft_type": "review_discrepancy",
        "entity_ref": "order_101",
        "state": "confirmed",
    }

    payload = draft_to_action_payload(draft)

    assert payload == {
        "signal_code": "order_mismatch",
        "entity_ref": "order_101",
    }

    with patch("app.services.action_confirmation_bridge.execute_action_from_signal") as exec_mock:
        exec_mock.return_value = {
            "action_type": "review_order",
            "status": "executed",
            "signal_code": "order_mismatch",
            "entity_ref": "order_101",
        }
        result = execute_if_confirmed(draft, tenant_id="tenant_1")

    exec_mock.assert_called_once_with(payload)
    assert result["status"] == "executed"


def test_pending_confirmation_blocked() -> None:
    draft = {
        "draft_type": "review_discrepancy",
        "entity_ref": "order_101",
        "state": "pending_confirmation",
    }

    with patch("app.services.action_confirmation_bridge.execute_action_from_signal") as exec_mock:
        with pytest.raises(ValueError, match="not executable"):
            execute_if_confirmed(draft, tenant_id="tenant_1")
    exec_mock.assert_not_called()


def test_cancelled_blocked() -> None:
    draft = {
        "draft_type": "review_discrepancy",
        "entity_ref": "order_101",
        "state": "cancelled",
    }

    with patch("app.services.action_confirmation_bridge.execute_action_from_signal") as exec_mock:
        with pytest.raises(ValueError, match="not executable"):
            execute_if_confirmed(draft, tenant_id="tenant_1")
    exec_mock.assert_not_called()


def test_no_execution_on_invalid_state() -> None:
    draft = {
        "draft_type": "review_discrepancy",
        "entity_ref": "order_101",
        "state": "draft",
    }

    with patch("app.services.action_confirmation_bridge.execute_action_from_signal") as exec_mock:
        with pytest.raises(ValueError, match="not executable"):
            execute_if_confirmed(draft, tenant_id="tenant_1")
    exec_mock.assert_not_called()

