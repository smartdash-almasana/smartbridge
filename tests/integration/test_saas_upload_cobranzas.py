from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.routes import saas


@pytest.mark.anyio
async def test_saas_upload_single_mode_uses_ingestion_pipeline_and_returns_stable_contract(monkeypatch, tmp_path: Path) -> None:
    created_dirs: list[Path] = []
    orchestrator_calls: list[dict] = []
    persist_calls: list[tuple] = []
    index_calls: list[dict] = []

    def _fake_create_request_dir(ingestion_id: str) -> Path:
        d = tmp_path / ingestion_id
        d.mkdir(parents=True, exist_ok=True)
        created_dirs.append(d)
        return d

    def _fake_orchestrator(**kwargs) -> dict:
        orchestrator_calls.append(kwargs)
        return {
            "signals": [{"signal_code": "duplicate_order", "entity_ref": "order_cmp-ax"}],
            "lifecycle": {"open": [], "persisting": [], "resolved": []},
            "batch_result": {"batch_status": "success", "processed": 1, "failed": 0},
        }

    def _fake_persist_ingestion(*args):
        persist_calls.append(args)
        return {"quality_score": 0.91, "risk_score": 0.12}

    monkeypatch.setattr(saas, "_create_request_dir", _fake_create_request_dir)
    monkeypatch.setattr(saas, "persist_ingestion", _fake_persist_ingestion)
    monkeypatch.setattr(
        saas,
        "run_orchestrator_pipeline",
        _fake_orchestrator,
    )
    monkeypatch.setattr(saas, "update_global_index", lambda payload: index_calls.append(payload))

    app = FastAPI()
    app.include_router(saas.router)

    csv_bytes = (
        "comprobante_id,importe,cliente,vencimiento\n"
        "CMP-AX,1234.50,Acme SA,2026-05-10\n"
        "CMP-AX,1234.50,Acme SA,2026-05-10\n"
    ).encode("utf-8")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/saas/upload?debug=1",
            files={"file": ("cobranzas.csv", csv_bytes, "text/csv")},
        )

    assert response.status_code == 200
    body = response.json()

    # Stable HTTP contract in debug mode
    assert set(body.keys()) == {"ingestion_id", "debug", "signals", "orchestration"}
    assert isinstance(body["ingestion_id"], str) and body["ingestion_id"].strip()
    assert isinstance(body["signals"], list)
    assert isinstance(body["orchestration"], dict)

    # Evidence of unified single_mode ingestion execution
    assert created_dirs, "single_mode should create a request dir"
    assert any((d / "cobranzas.csv").exists() for d in created_dirs)
    assert body["signals"], "Expected non-empty generated signals from ingestion path"
    first_signal = body["signals"][0]
    assert isinstance(first_signal, dict)
    assert "signal_code" in first_signal
    assert "entity_ref" in first_signal
    assert len(orchestrator_calls) == 1
    assert isinstance(orchestrator_calls[0]["findings"], list)
    assert len(orchestrator_calls[0]["findings"]) == len(body["signals"])

    # single_mode traceability persistence call
    assert len(persist_calls) == 1
    call = persist_calls[0]
    assert len(call) == 5
    assert isinstance(call[0], str) and call[0].strip()  # ingestion_id
    assert isinstance(call[1], Path) and call[1].name == "cobranzas.csv"  # single_path
    assert isinstance(call[2], list) and len(call[2]) > 0  # ventas + facturas normalized dataset
    assert call[3] == {}  # mapping
    assert call[4] == "upload"  # subfolder

    # metadata reuse in common block -> update_global_index payload
    assert len(index_calls) == 1
    idx_payload = index_calls[0]
    assert isinstance(idx_payload.get("ingestion_id"), str) and idx_payload["ingestion_id"].strip()
    assert idx_payload["ingestion_id"] == body["ingestion_id"]
    assert idx_payload["quality_score"] == 0.91
    assert idx_payload["priority"] == "LOW"
