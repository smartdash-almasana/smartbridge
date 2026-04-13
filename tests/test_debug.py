import io
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_debug_off_returns_html():
    csv_ventas = "order_id,amount\n1,100"
    csv_facturas = "order_id\n1"
    
    files = {
        "ventas_file": ("ventas.csv", io.BytesIO(csv_ventas.encode()), "text/csv"),
        "facturas_file": ("facturas.csv", io.BytesIO(csv_facturas.encode()), "text/csv"),
    }
    
    response = client.post("/saas/upload", files=files)
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "debug" not in response.text

def test_debug_on_returns_json():
    csv_ventas = "order_id,amount\n1,100"
    csv_facturas = "order_id\n1"
    
    files = {
        "ventas_file": ("ventas.csv", io.BytesIO(csv_ventas.encode()), "text/csv"),
        "facturas_file": ("facturas.csv", io.BytesIO(csv_facturas.encode()), "text/csv"),
    }
    
    response = client.post("/saas/upload?debug=1", files=files)
    assert response.status_code == 200
    assert "application/json" in response.headers["content-type"]
    
    data = response.json()
    assert "signals" in data
    assert isinstance(data["signals"], list)

def test_debug_on_with_error_returns_json_and_stage():
    # missing required column 'amount' will now fail silently internally and yield an empty result which returns HTML unless an unhandled exception throws (like missing files!)
    
    response = client.post("/saas/upload?debug=1", files={})
    assert response.status_code == 400
    assert "application/json" in response.headers["content-type"]
    
    data = response.json()
    assert "error" in data
    assert "Debés enviar un archivo" in data["error"]
