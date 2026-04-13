import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from app.services.digest.build_action_output import build_action_output


def run_tests() -> None:
    # Test 1: known signal
    digest_known = {
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
    out_known = build_action_output(digest_known)
    assert out_known == {
        "message": "Tenés 1 alerta activa: order_mismatch en order_123.",
        "suggested_action": "Revisar inconsistencia en la orden.",
    }

    # Test 2: unknown signal
    digest_unknown = {
        "summary": {
            "total_active_signals": 2,
            "signals": [
                {
                    "signal_code": "new_signal_code",
                    "entity_ref": "order_999",
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
    out_unknown = build_action_output(digest_unknown)
    assert out_unknown == {
        "message": "Tenés 2 alertas activas. La más reciente es new_signal_code en order_999.",
        "suggested_action": "Revisar señal detectada.",
    }

    # Test 3: no signals
    digest_empty = {
        "summary": {
            "total_active_signals": 0,
            "signals": [],
        }
    }
    out_empty = build_action_output(digest_empty)
    assert out_empty == {
        "message": "Hoy no hay alertas activas.",
        "suggested_action": "No se requiere acción.",
    }


if __name__ == "__main__":
    run_tests()
    print("ok")


