import pytest

from app.services.confirmation_layer import (
    mark_draft_cancelled,
    mark_draft_confirmed,
    mark_draft_pending_confirmation,
)


def test_draft_to_pending_confirmation() -> None:
    draft = {"draft_type": "review_discrepancy", "entity_ref": "order_1", "state": "draft"}
    result = mark_draft_pending_confirmation(draft)
    assert result["state"] == "pending_confirmation"
    assert draft["state"] == "draft"


def test_pending_confirmation_to_confirmed() -> None:
    draft = {"draft_type": "review_discrepancy", "entity_ref": "order_1", "state": "pending_confirmation"}
    result = mark_draft_confirmed(draft)
    assert result["state"] == "confirmed"


def test_pending_confirmation_to_cancelled() -> None:
    draft = {"draft_type": "review_discrepancy", "entity_ref": "order_1", "state": "pending_confirmation"}
    result = mark_draft_cancelled(draft)
    assert result["state"] == "cancelled"


def test_invalid_transition_raises_error() -> None:
    draft = {"draft_type": "review_discrepancy", "entity_ref": "order_1", "state": "draft"}
    with pytest.raises(ValueError, match="Invalid transition"):
        mark_draft_confirmed(draft)

