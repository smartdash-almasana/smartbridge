from app.services import findings_engine


def test_build_findings_detects_all_core_conditions() -> None:
    rows = [
        {
            "entity_id": "E-1",
            "order_id": "A-1",
            "amount": 100,
            "expected_amount": 90,
            "status": "paid",
        },
        {
            "entity_id": "E-2",
            "order_id": "A-2",
            "amount": 0,
            "expected_amount": 50,
            "status": "pending",
        },
        {
            "entity_id": "E-3",
            "order_id": "A-2",
            "amount": 10,
            "expected_amount": 10,
            "status": "UNKNOWN",
        },
    ]

    findings = findings_engine.build_findings(rows)
    finding_types = [f["type"] for f in findings]

    assert finding_types == [
        "amount_mismatch",
        "missing_amount",
        "duplicate_order",
        "unknown_status",
        "duplicate_order",
    ]


def test_build_findings_skips_non_dict_after_duplicate_scan() -> None:
    rows = [{"order_id": "A-1", "amount": 10, "expected_amount": 10, "status": "paid", "entity_id": "E1"}]
    findings = findings_engine.build_findings(rows)
    assert findings == []


def test_build_findings_handles_invalid_top_level_input() -> None:
    assert findings_engine.build_findings([]) == []
    assert findings_engine.build_findings(None) == []  # type: ignore[arg-type]
    try:
        findings_engine.build_findings("not-a-list")  # type: ignore[arg-type]
        assert False, "Expected AttributeError"
    except AttributeError:
        assert True

    try:
        findings_engine.build_findings([{"order_id": "A-1"}, "bad"])  # type: ignore[list-item]
        assert False, "Expected AttributeError"
    except AttributeError:
        assert True


def test_unknown_status_accepts_valid_status_with_whitespace_and_case() -> None:
    row = {"status": "  PAID  ", "entity_id": "E-1"}
    assert findings_engine._evaluate_unknown_status(row) is None


def test_duplicate_id_detection_normalizes_to_strings() -> None:
    rows = [
        {"order_id": 7},
        {"order_id": "7"},
        {"order_id": "8"},
        {"order_id": None},
    ]
    duplicates = findings_engine._get_duplicate_ids(rows)
    assert duplicates == {"7"}
