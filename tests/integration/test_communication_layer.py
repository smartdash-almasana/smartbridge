from app.services.communication_layer import build_human_messages


def test_low_difference_still_requires_action() -> None:
    findings = [
        {
            "finding_id": "fnd_1",
            "entity_ref": "producto_A",
            "difference": 1,
            "source_a": {"quantity": 8},
            "source_b": {"quantity": 7},
        }
    ]

    messages = build_human_messages(findings, "ui")

    assert len(messages) == 1
    msg = messages[0]
    assert msg["urgency"] == "baja"
    assert msg["action_required"] is True
    assert msg["action_description"] is not None


def test_suggested_action_maps_to_action_description() -> None:
    findings = [
        {
            "finding_id": "fnd_2",
            "entity_ref": "order_123",
            "suggested_action": "Confirmar stock con deposito antes de cerrar pedido.",
        }
    ]

    messages = build_human_messages(findings, "ui")

    assert len(messages) == 1
    msg = messages[0]
    assert msg["action_required"] is True
    assert (
        msg["action_description"]
        == "Confirmar stock con deposito antes de cerrar pedido."
    )


def test_conservative_urgency_fallback_is_media() -> None:
    findings = [{"finding_id": "fnd_3", "entity_ref": "order_999"}]

    messages = build_human_messages(findings, "ui")

    assert len(messages) == 1
    assert messages[0]["urgency"] == "media"
    assert messages[0]["action_required"] is False
    assert messages[0]["action_description"] is None


def test_supports_source_a_value_source_b_value() -> None:
    findings = [
        {
            "finding_id": "fnd_4",
            "entity_ref": "sku_100",
            "source_a_value": 15,
            "source_b_value": 5,
        }
    ]

    messages = build_human_messages(findings, "ui")

    assert len(messages) == 1
    msg = messages[0]
    assert msg["urgency"] == "alta"
    assert msg["action_required"] is True
    assert "A=15" in msg["message_text"]
    assert "B=5" in msg["message_text"]


def test_optional_missing_fields_do_not_hallucinate() -> None:
    findings = [{"finding_id": "fnd_5"}]

    messages = build_human_messages(findings, "ui")

    assert len(messages) == 1
    msg = messages[0]
    assert msg["entity_ref"] is None
    assert "la entidad" in msg["message_text"]
    assert "sin dato" in msg["message_text"]
    assert msg["action_required"] is False
    assert msg["action_description"] is None


def test_deterministic_output_for_same_input() -> None:
    findings = [
        {
            "finding_id": "fnd_6",
            "entity_ref": "producto_A",
            "difference": 2,
            "source_a_value": 11,
            "source_b_value": 9,
        }
    ]

    first = build_human_messages(findings, "ui")
    second = build_human_messages(findings, "ui")
    assert first == second


def test_whatsapp_channel_format() -> None:
    findings = [
        {
            "finding_id": "fnd_7",
            "entity_ref": "producto_B",
            "difference": 3,
            "source_a": {"quantity": 10},
            "source_b": {"quantity": 7},
        }
    ]

    messages = build_human_messages(findings, "whatsapp")
    msg = messages[0]

    assert msg["channel"] == "whatsapp"
    assert msg["message_text"].count(".") <= 3
    assert "producto_B" in msg["message_text"]
