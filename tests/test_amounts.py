import pytest
from app.services.column_mapper import parse_amount

def test_parse_amount_cases():
    assert parse_amount("1.000,50") == 1000.50
    assert parse_amount("$ 1.200") == 1200.0
    assert parse_amount("ARS 3,500.75") == 3500.75
    assert parse_amount("1 200,00") == 1200.0
    assert parse_amount("-500") == -500.0
    assert parse_amount("(1.200,50)") == -1200.50
    assert parse_amount("$ 1.000,50") == 1000.50
    assert parse_amount("ARS 2000") == 2000.0
    assert parse_amount("abc") is None
    assert parse_amount("") is None
    assert parse_amount(None) is None
