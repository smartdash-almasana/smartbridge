from app.services import findings_engine
import signals_engine


def test_findings_to_signals_pipeline_core_and_determinism() -> None:
    rows = [
        {"entity_id": "E1", "order_id": "A1", "amount": 100, "expected_amount": 90, "status": "paid"},
        {"entity_id": "E2", "order_id": "A2", "amount": 0, "expected_amount": 50, "status": "pending"},
        {"entity_id": "E3", "order_id": "A2", "amount": 10, "expected_amount": 10, "status": "bad-status"},
    ]

    findings_1 = findings_engine.build_findings(rows)
    findings_2 = findings_engine.build_findings(rows)
    assert findings_1 == findings_2

    signals_1 = signals_engine.build_signals(
        findings=findings_1,
        tenant_id="tenant-x",
        module="reconciliation",
        created_at="2026-04-01T12:00:00Z",
    )
    signals_2 = signals_engine.build_signals(
        findings=findings_2,
        tenant_id="tenant-x",
        module="reconciliation",
        created_at="2026-04-01T12:00:00Z",
    )
    assert signals_1 == signals_2

    assert [s["signal_code"] for s in signals_1] == [
        "order_mismatch",
        "amount_missing_detected",
        "duplicate_order_detected",
        "invalid_status_detected",
        "duplicate_order_detected",
    ]
    assert all(s["source_module"] == "reconciliation" for s in signals_1)
    assert all(s["created_at"] == "2026-04-01T12:00:00Z" for s in signals_1)


def test_findings_to_signals_handles_invalid_inputs() -> None:
    assert findings_engine.build_findings(None) == []  # type: ignore[arg-type]
    assert signals_engine.build_signals([], "tenant-x", "reconciliation", "2026-04-01T12:00:00Z") == []
