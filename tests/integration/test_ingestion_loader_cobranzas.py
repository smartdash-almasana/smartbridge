from pathlib import Path

from app.services.ingestion_loader import run_ingestion_pipeline


def test_run_ingestion_pipeline_cobranzas_contract_and_additive_fields(tmp_path: Path) -> None:
    csv_path = tmp_path / "cobranzas.csv"
    csv_path.write_text(
        "comprobante_id,importe,cliente,vencimiento\n"
        "CMP-AX,1234.50,Acme SA,2026-05-10\n",
        encoding="utf-8",
    )

    result = run_ingestion_pipeline(csv_path)

    # 1) Top-level contract remains unchanged
    assert set(result.keys()) == {
        "ventas",
        "facturas",
        "valid_rows",
        "total_rows",
        "document_type",
    }

    assert isinstance(result["ventas"], list)
    assert isinstance(result["facturas"], list)
    assert isinstance(result["valid_rows"], int)
    assert isinstance(result["total_rows"], int)
    assert isinstance(result["document_type"], str)

    # 2) Base compatibility fields preserved in normalized rows
    normalized_rows = result["ventas"] + result["facturas"]
    assert normalized_rows, "Expected at least one normalized row"
    row = normalized_rows[0]
    assert "order_id" in row
    assert "amount" in row

    # 3) Additive Cobranzas fields supported when inferred
    assert row.get("cliente") == "Acme SA"
    assert row.get("fecha_vencimiento") == "2026-05-10"

    # 4) monto appears only when there is valid_amount (ventas rows are valid_amount rows)
    assert "monto" in row
    assert row["monto"] == row["amount"]
