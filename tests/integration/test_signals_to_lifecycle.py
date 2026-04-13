import signals_engine
from app.services.signals.global_signals import compute_signal_lifecycle


def test_signals_to_lifecycle_open_then_persisting_then_resolved() -> None:
    findings_run_1 = [
        {"type": "amount_mismatch", "severity": "high", "metadata": {"order_id": "100"}},
        {"type": "missing_amount", "severity": "medium", "metadata": {"order_id": "200"}},
    ]
    findings_run_2 = [
        {"type": "amount_mismatch", "severity": "high", "metadata": {"order_id": "100"}},
    ]

    current_1 = signals_engine.build_signals(
        findings_run_1,
        tenant_id="tenant-x",
        module="reconciliation",
        created_at="2026-04-01T12:00:00Z",
    )
    lc_1 = compute_signal_lifecycle(previous_signals=[], current_signals=current_1)
    assert len(lc_1["lifecycle"]["open"]) == 2
    assert lc_1["lifecycle"]["persisting"] == []
    assert lc_1["lifecycle"]["resolved"] == []

    current_2 = signals_engine.build_signals(
        findings_run_1,
        tenant_id="tenant-x",
        module="reconciliation",
        created_at="2026-04-01T12:05:00Z",
    )
    lc_2 = compute_signal_lifecycle(previous_signals=lc_1["current"], current_signals=current_2)
    assert len(lc_2["lifecycle"]["open"]) == 0
    assert len(lc_2["lifecycle"]["persisting"]) == 2
    assert len(lc_2["lifecycle"]["resolved"]) == 0

    current_3 = signals_engine.build_signals(
        findings_run_2,
        tenant_id="tenant-x",
        module="reconciliation",
        created_at="2026-04-01T12:10:00Z",
    )
    lc_3 = compute_signal_lifecycle(previous_signals=lc_2["current"], current_signals=current_3)
    assert len(lc_3["lifecycle"]["open"]) == 0
    assert len(lc_3["lifecycle"]["persisting"]) == 1
    assert len(lc_3["lifecycle"]["resolved"]) == 1
    assert lc_3["lifecycle"]["resolved"][0]["entity_ref"] == "order_200"

