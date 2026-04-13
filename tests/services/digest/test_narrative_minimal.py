import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.services.digest.build_narrative import build_narrative


def run_tests() -> None:
    # Test 1: empty
    digest_empty = {
        "summary": {
            "total_active_signals": 0,
            "signals": [],
        }
    }
    out_empty = build_narrative(digest_empty)
    assert out_empty == {"message": "Hoy no hay alertas activas."}

    # Test 2: one signal
    digest_one = {
        "summary": {
            "total_active_signals": 1,
            "signals": [
                {
                    "signal_code": "order_mismatch",
                    "entity_ref": "order_123",
                    "last_seen_at": "2026-04-11T15:00:00Z",
                }
            ],
        }
    }
    out_one = build_narrative(digest_one)
    assert out_one == {"message": "Tenés 1 alerta activa: order_mismatch en order_123."}

    # Test 3: multiple
    digest_many = {
        "summary": {
            "total_active_signals": 3,
            "signals": [
                {
                    "signal_code": "order_missing_in_documents",
                    "entity_ref": "order_555",
                    "last_seen_at": "2026-04-11T15:05:00Z",
                },
                {
                    "signal_code": "order_mismatch",
                    "entity_ref": "order_123",
                    "last_seen_at": "2026-04-11T15:00:00Z",
                },
            ],
        }
    }
    out_many = build_narrative(digest_many)
    assert out_many == {
        "message": "Tenés 3 alertas activas. La más reciente es order_missing_in_documents en order_555."
    }


if __name__ == "__main__":
    run_tests()
    print("ok")


