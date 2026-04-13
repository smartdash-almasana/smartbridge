import signals_engine


def test_map_finding_to_signal_maps_core_fields() -> None:
    finding = {
        "type": "amount_mismatch",
        "severity": "high",
        "metadata": {"order_id": "123"},
        "description": "Mismatch in total",
    }

    signal = signals_engine.map_finding_to_signal(
        finding=finding,
        tenant_id="tenant-x",
        module="reconciliation",
        index=0,
        created_at="2026-01-01T00:00:00Z",
    )

    assert signal["signal_code"] == "order_mismatch"
    assert signal["severity"] == "high"
    assert signal["entity_ref"] == "order_123"
    assert signal["source_module"] == "reconciliation"
    assert signal["created_at"] == "2026-01-01T00:00:00Z"
    assert signal["context"] == ["Mismatch in total"]


def test_map_finding_to_signal_uses_fallbacks_for_unknown_type_and_missing_text() -> None:
    finding = {"type": "strange_type", "severity": 999}

    signal = signals_engine.map_finding_to_signal(
        finding=finding,
        tenant_id="tenant-x",
        module="reconciliation",
        index=2,
        created_at="2026-01-01T00:00:00Z",
    )

    assert signal["signal_code"] == "custom_strange_type_detected"
    assert signal["severity"] == "low"
    assert signal["context"] == ["no_additional_context"]


def test_extract_entity_id_is_deterministic_when_no_ids_available() -> None:
    finding = {"type": "order_mismatch", "metadata": {}}
    first = signals_engine.extract_entity_id(finding, 3)
    second = signals_engine.extract_entity_id(finding, 3)
    third = signals_engine.extract_entity_id(finding, 4)

    assert first == second
    assert first.startswith("order_ref_")
    assert first != third


def test_build_signals_validates_created_at() -> None:
    try:
        signals_engine.build_signals(
            findings=[{"type": "order_mismatch"}],
            tenant_id="tenant-x",
            module="reconciliation",
            created_at=None,  # type: ignore[arg-type]
        )
        assert False, "Expected ValueError"
    except ValueError as exc:
        assert "created_at" in str(exc)


def test_build_signals_handles_invalid_input_and_skips_non_dict_items() -> None:
    assert signals_engine.build_signals("bad", "t", "m", "2026-01-01T00:00:00Z") == []  # type: ignore[arg-type]

    signals = signals_engine.build_signals(
        findings=[{"type": "amount_mismatch", "severity": "high"}, "bad", 10],
        tenant_id="tenant-x",
        module="reconciliation",
        created_at="2026-01-01T00:00:00Z",
    )
    assert len(signals) == 1
