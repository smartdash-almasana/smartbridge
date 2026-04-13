import io
import json
import os
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_persistence_creates_files():
    csv_ventas = "order_id,amount\nA1,1000.50\nA2,-500"
    csv_facturas = "order_id\nA1\nA2"
    
    files = {
        "ventas_file": ("ventas.csv", io.BytesIO(csv_ventas.encode()), "text/csv"),
        "facturas_file": ("facturas.csv", io.BytesIO(csv_facturas.encode()), "text/csv"),
    }
    
    response = client.post("/saas/upload?debug=1", files=files)
    assert response.status_code == 200
    
    data = response.json()
    assert "ingestion_id" in data
    ingestion_id = data["ingestion_id"]
    assert ingestion_id

    # Check persistence folders
    ventas_path = Path(f"data/ingestions/{ingestion_id}/ventas")
    facturas_path = Path(f"data/ingestions/{ingestion_id}/facturas")
    
    assert ventas_path.exists()
    assert facturas_path.exists()

    # Verify ventas files
    assert (ventas_path / "input.csv").exists()
    assert (ventas_path / "normalized.json").exists()
    assert (ventas_path / "metadata.json").exists()

    # Content verification
    with (ventas_path / "normalized.json").open("r", encoding="utf-8") as f:
        normalized_data = json.load(f)
        assert len(normalized_data) == 2
        assert normalized_data[0]["order_id"] == "a1"
        assert normalized_data[0]["amount"] == 1000.50

    with (ventas_path / "metadata.json").open("r", encoding="utf-8") as f:
        metadata = json.load(f)
        assert metadata["ingestion_id"] == ingestion_id
        assert metadata["row_count"] == 2
        assert "columns_detected" in metadata
