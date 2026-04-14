from unittest.mock import patch

from app.services.action_drafting import (
    finding_to_action_draft,
    findings_to_action_drafts,
)


def test_single_finding_to_draft() -> None:
    finding = {
        "finding_id": "fnd_order_mismatch_order_101",
        "type": "order_mismatch",
        "entity_ref": "order_101",
    }

    draft = finding_to_action_draft(finding)

    assert draft["draft_type"] == "review_discrepancy"
    assert draft["entity_ref"] == "order_101"
    assert draft["source_finding_id"] == "fnd_order_mismatch_order_101"
    assert draft["requires_confirmation"] is True
    assert "order_mismatch" in draft["summary"]


def test_multiple_findings_to_drafts() -> None:
    findings = [
        {
            "finding_id": "f1",
            "type": "order_missing_in_documents",
            "entity_ref": "order_1",
        },
        {
            "finding_id": "f2",
            "type": "order_mismatch",
            "entity_ref": "order_2",
        },
    ]

    drafts = findings_to_action_drafts(findings)

    assert len(drafts) == 2
    assert drafts[0]["source_finding_id"] == "f1"
    assert drafts[1]["source_finding_id"] == "f2"
    assert drafts[0]["draft_type"] == "request_information"
    assert drafts[1]["draft_type"] == "review_discrepancy"


def test_empty_findings_returns_empty_list() -> None:
    assert findings_to_action_drafts([]) == []


def test_no_execution_side_effects() -> None:
    findings = [
        {
            "finding_id": "f1",
            "type": "order_mismatch",
            "entity_ref": "order_1",
        }
    ]

    with patch("app.services.action_engine.from_signals.execute_action_from_signal") as exec_mock:
        with patch("app.services.action_engine.dispatcher.dispatch_actions") as dispatch_mock:
            drafts = findings_to_action_drafts(findings)

    exec_mock.assert_not_called()
    dispatch_mock.assert_not_called()
    assert len(drafts) == 1

