from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.actions import router as actions_router


def _build_client() -> TestClient:
    app = FastAPI()
    app.include_router(actions_router)
    return TestClient(app)


def test_confirmed_draft_executes() -> None:
    client = _build_client()
    payload = {
        "tenant_id": "tenant_1",
        "draft": {
            "draft_type": "review_discrepancy",
            "entity_ref": "order_101",
            "state": "confirmed",
        },
    }

    with patch("app.api.routes.actions.execute_if_confirmed") as execute_mock:
        execute_mock.return_value = {
            "action_type": "review_order",
            "status": "executed",
            "signal_code": "order_mismatch",
            "entity_ref": "order_101",
        }
        resp = client.post("/api/v1/actions/confirm-execute", json=payload)

    assert resp.status_code == 200
    assert resp.json()["status"] == "executed"
    execute_mock.assert_called_once_with(payload["draft"], payload["tenant_id"])


def test_pending_confirmation_blocked() -> None:
    client = _build_client()
    payload = {
        "tenant_id": "tenant_1",
        "draft": {
            "draft_type": "review_discrepancy",
            "entity_ref": "order_101",
            "state": "pending_confirmation",
        },
    }

    with patch("app.api.routes.actions.execute_if_confirmed") as execute_mock:
        execute_mock.side_effect = ValueError("Draft state 'pending_confirmation' is not executable. Expected 'confirmed'.")
        resp = client.post("/api/v1/actions/confirm-execute", json=payload)

    assert resp.status_code == 400
    assert "not executable" in resp.json()["detail"]
    execute_mock.assert_called_once()


def test_cancelled_blocked() -> None:
    client = _build_client()
    payload = {
        "tenant_id": "tenant_1",
        "draft": {
            "draft_type": "review_discrepancy",
            "entity_ref": "order_101",
            "state": "cancelled",
        },
    }

    with patch("app.api.routes.actions.execute_if_confirmed") as execute_mock:
        execute_mock.side_effect = ValueError("Draft state 'cancelled' is not executable. Expected 'confirmed'.")
        resp = client.post("/api/v1/actions/confirm-execute", json=payload)

    assert resp.status_code == 400
    assert "not executable" in resp.json()["detail"]
    execute_mock.assert_called_once()


def test_invalid_payload_fails() -> None:
    client = _build_client()
    payload = {
        "tenant_id": "tenant_1",
        "draft": "not-a-dict",
    }

    with patch("app.api.routes.actions.execute_if_confirmed") as execute_mock:
        resp = client.post("/api/v1/actions/confirm-execute", json=payload)

    assert resp.status_code == 422
    execute_mock.assert_not_called()

