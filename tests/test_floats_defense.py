import pandas as pd
from app.services.scoring import compute_risk_score

def test_mixed_types_dont_break_scoring():
    # Mezcla estricta de string, float y nulls.
    dirty_amounts = [
        {"amount": "1000"},     # String limpio
        {"amount": "$1000"},    # String con moneda
        {"amount": 550.0},      # Float nativo
        {"amount": None},       # Null directo
        {"amount": "(200)"},    # Contable negativo
        {"amount": "basura"},   # Inparseable
    ]
    df = pd.DataFrame(dirty_amounts)
    
    # Esto debiera devolver un risk sin patear expceciones de math > str
    risk = compute_risk_score(df)
    
    # Validaciones logicas de la extraccion
    # Amounts validos sacados serian: 1000.0, 1000.0, 550.0, -200.0
    # Q95 es cerca de 1000, maximo elemento no supera estrictamente con ese percentil?
    assert isinstance(risk, float)
    assert risk > 0.0

