from app.services.communication_layer import classify_urgency, findings_to_messages


def test_whatsapp_message_generated() -> None:
    findings = [
        {
            "finding_id": "fnd_1",
            "entity_name": "producto A",
            "difference": 3,
            "source_a": {"quantity": 8},
            "source_b": {"quantity": 5},
        }
    ]

    messages = findings_to_messages(findings, "whatsapp")

    assert len(messages) == 1
    msg = messages[0]
    assert msg["channel"] == "whatsapp"
    assert msg["finding_id"] == "fnd_1"
    assert "producto A" in msg["message_text"]
    assert "diferencia de 3" in msg["message_text"]
    assert msg["message_text"].count(".") <= 3


def test_email_message_generated() -> None:
    findings = [
        {
            "finding_id": "fnd_2",
            "entity_ref": "order_123",
            "difference": 12,
            "source_a": {"quantity": 20},
            "source_b": {"quantity": 8},
        }
    ]

    messages = findings_to_messages(findings, "email")

    assert len(messages) == 1
    msg = messages[0]
    assert msg["channel"] == "email"
    assert msg["urgency"] == "high"
    assert msg["action_required"] is True
    assert "A=20" in msg["message_text"]
    assert "B=8" in msg["message_text"]


def test_urgency_classified() -> None:
    high = {"severity": "high"}
    medium = {"difference": 7}
    low = {"difference": 1}

    assert classify_urgency(high) == "high"
    assert classify_urgency(medium) == "medium"
    assert classify_urgency(low) == "low"


def test_urgency_conservative_fallback_keeps_legacy_medium() -> None:
    assert classify_urgency({"finding_id": "fnd_no_data"}) == "medium"


def test_empty_findings_returns_empty_list() -> None:
    assert findings_to_messages([], "ui") == []


def test_legacy_suggested_action_is_mapped_to_action_description() -> None:
    findings = [
        {
            "finding_id": "fnd_legacy_1",
            "suggested_action": "Validar contra inventario fisico.",
        }
    ]

    messages = findings_to_messages(findings, "ui")
    assert len(messages) == 1
    assert messages[0]["action_required"] is True
    assert messages[0]["action_description"] == "Validar contra inventario fisico."

