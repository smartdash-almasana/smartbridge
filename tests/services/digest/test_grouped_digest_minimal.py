import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.services.digest.build_grouped_digest import build_grouped_digest


def test_grouping_correctness() -> None:
    digest = {
        "summary": {
            "signals": [
                {
                    "signal_code": "order_missing_in_documents",
                    "entity_ref": "order_1",
                    "last_seen_at": "2026-04-11T10:00:00Z",
                    "priority": 3,
                    "group": "orders",
                },
                {
                    "signal_code": "order_mismatch",
                    "entity_ref": "order_2",
                    "last_seen_at": "2026-04-11T09:00:00Z",
                    "priority": 2,
                    "group": "orders",
                },
            ]
        }
    }

    grouped = build_grouped_digest(digest)
    assert len(grouped["groups"]) == 1
    assert grouped["groups"][0]["group"] == "orders"
    assert [s["signal_code"] for s in grouped["groups"][0]["signals"]] == [
        "order_missing_in_documents",
        "order_mismatch",
    ]


def test_grouped_order_preservation() -> None:
    digest = {
        "summary": {
            "signals": [
                {
                    "signal_code": "order_mismatch",
                    "entity_ref": "order_1",
                    "last_seen_at": "2026-04-11T10:00:00Z",
                    "priority": 2,
                    "group": "orders",
                },
                {
                    "signal_code": "unknown_signal",
                    "entity_ref": "order_2",
                    "last_seen_at": "2026-04-11T09:00:00Z",
                    "priority": 0,
                    "group": "other",
                },
                {
                    "signal_code": "duplicate_order",
                    "entity_ref": "order_3",
                    "last_seen_at": "2026-04-11T08:00:00Z",
                    "priority": 0,
                    "group": "orders",
                },
            ]
        }
    }

    grouped = build_grouped_digest(digest)
    assert [g["group"] for g in grouped["groups"]] == ["orders", "other"]
    assert [s["entity_ref"] for s in grouped["groups"][0]["signals"]] == ["order_1", "order_3"]


def test_unknown_signal_group_default_other() -> None:
    digest = {
        "summary": {
            "signals": [
                {
                    "signal_code": "unknown_signal",
                    "entity_ref": "order_x",
                    "last_seen_at": "2026-04-11T10:00:00Z",
                    "priority": 0,
                }
            ]
        }
    }

    grouped = build_grouped_digest(digest)
    assert grouped["groups"][0]["group"] == "other"


if __name__ == "__main__":
    test_grouping_correctness()
    test_grouped_order_preservation()
    test_unknown_signal_group_default_other()
    print("ok")


