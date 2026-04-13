import io
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_ingestion_index_endpoints():
    csv_ventas = "order_id,amount\nA1,1000.50\nA2,-500"
    csv_facturas = "order_id\nA1"
    
    files = {
        "ventas_file": ("ventas.csv", io.BytesIO(csv_ventas.encode()), "text/csv"),
        "facturas_file": ("facturas.csv", io.BytesIO(csv_facturas.encode()), "text/csv"),
    }
    
    # Upload to create ingestion
    response = client.post("/saas/upload?debug=1", files=files)
    assert response.status_code == 200
    ingestion_id = response.json().get("ingestion_id")
    assert ingestion_id
    
    # 1. Test index list endpoint
    resp_list = client.get("/saas/ingestions")
    assert resp_list.status_code == 200
    data_list = resp_list.json()
    assert "ingestions" in data_list
    assert len(data_list["ingestions"]) > 0
    
    # Find our ingestion
    found = next((item for item in data_list["ingestions"] if item["ingestion_id"] == ingestion_id), None)
    assert found
    assert found["ventas_count"] == 2
    assert found["facturas_count"] == 1
    assert "timestamp" in found
    
    # 2. Test detailed ingestion endpoint
    resp_detail = client.get(f"/saas/ingestions/{ingestion_id}")
    assert resp_detail.status_code == 200
    data_detail = resp_detail.json()
    assert data_detail["ingestion_id"] == ingestion_id
    assert "ventas" in data_detail
    assert "facturas" in data_detail
    
    # Check meta keys in subfolder
    assert data_detail["ventas"]["row_count"] == 2
    assert data_detail["facturas"]["row_count"] == 1
    
    # 3. Test non-existent ingestion
    resp_404 = client.get("/saas/ingestions/no_existe_jamas")
    assert resp_404.status_code == 404
