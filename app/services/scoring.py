from typing import Any
import pandas as pd

def compute_quality_score(df: Any, mapping: dict[str, str]) -> float:
    """
    * % filas válidas (peso 50%) -> sobre base DataFrame parseado en validación aprox.
    * % amount no nulo (peso 30%)
    * columnas mapeadas vs requeridas (peso 20%)
    """
    from pathlib import Path
    if df is None or isinstance(df, Path) or len(df) == 0:
        return 0.5
    
    total = len(df)
    expected_cols = 2 if "amount" in mapping else 1
    col_score = min(1.0, len(mapping) / expected_cols)
    
    valid_rows = 0
    valid_amounts = 0
    
    if "order_id" in mapping and "amount" in mapping:
        raw_order = mapping["order_id"]
        raw_amount = mapping["amount"]
        if raw_order in df.columns:
            valid_rows = (df[raw_order].notna() & (df[raw_order].astype(str).str.strip() != "")).sum()
        if raw_amount in df.columns:
            # aproximado sobre strings
            valid_amounts = df[raw_amount].notna().sum()
    elif "order_id" in mapping:
        raw_order = mapping["order_id"]
        if raw_order in df.columns:
            valid_rows = (df[raw_order].notna() & (df[raw_order].astype(str).str.strip() != "")).sum()
            valid_amounts = total
            
    perc_valid_rows = valid_rows / total
    perc_valid_amount = valid_amounts / total
    
    quality = (perc_valid_rows * 0.5) + (perc_valid_amount * 0.3) + (col_score * 0.2)
    return round(float(quality), 2)

def compute_risk_score(df: Any) -> float:
    """
    * montos negativos -> + riesgo
    * outliers (percentil 95) -> + riesgo
    * valores NaN -> + riesgo
    """
    if isinstance(df, list):
        if not df:
            return 0.0
        df_clean = pd.DataFrame(df)
    else:
        df_clean = df.copy()
        
    if df_clean.empty or "amount" not in df_clean.columns:
        return 0.0
        
    from app.services.column_mapper import parse_amount
    df_clean["amount"] = df_clean["amount"].apply(parse_amount)
    amounts = df_clean["amount"].dropna()
    if amounts.empty:
        return 0.0
        
    assert str(amounts.dtype) in ["float64", "float32"], "Critical: Amount not parsed strictly as float."
        
    n_negatives = (amounts < 0).sum()
    n_nans = df_clean["amount"].isna().sum()
    
    q95 = amounts.quantile(0.95)
    outliers = (amounts > q95).sum()
    
    total = len(df_clean)
    
    risk = (n_negatives / total) * 0.4 + (outliers / total) * 0.4 + (n_nans / total) * 0.2
    return round(float(risk), 2)

def compute_priority(quality: float, risk: float) -> str:
    if quality < 0.7 or risk >= 0.3:
        return "HIGH"
    if quality < 0.85 or risk >= 0.15:
        return "MEDIUM"
    return "LOW"
