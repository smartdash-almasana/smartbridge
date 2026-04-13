# =============================================================================
# FILE: app/services/ingestion_loader.py
# LAYER 1 — INGESTION (IO BOUND)
# =============================================================================
from __future__ import annotations

import logging
from pathlib import Path
from typing import List

import pandas as pd

logger = logging.getLogger(__name__)

_ENCODINGS = ["utf-8", "latin-1", "cp1252"]
_DELIMITERS = [",", ";", "\t", "|"]

def load_file(file_path: Path) -> pd.DataFrame:
    """Converts file to DataFrame with robust fallbacks. Never raises."""
    try:
        suffix = file_path.suffix.lower()
        if suffix in (".xlsx", ".xls"):
            return _read_excel_safe(file_path)
        return _read_csv_robust(file_path)
    except Exception as exc:
        logger.debug(f"Loader fallback triggered for {file_path}: {exc}")
        return pd.DataFrame()

def _read_excel_safe(file_path: Path) -> pd.DataFrame:
    engine = "openpyxl" if file_path.suffix.lower() == ".xlsx" else "xlrd"
    return pd.read_excel(file_path, engine=engine, dtype=str, keep_default_na=False)

def _read_csv_robust(file_path: Path) -> pd.DataFrame:
    for enc in _ENCODINGS:
        for sep in _DELIMITERS:
            try:
                df = pd.read_csv(
                    file_path,
                    encoding=enc,
                    sep=sep,
                    dtype=str,
                    keep_default_na=False,
                    on_bad_lines="skip",
                    low_memory=False,
                )
                if not df.empty and df.shape[1] >= 1:
                    return df
            except Exception:
                continue

    # Fallback: raw line ingestion
    return _ingest_raw_lines(file_path)

def _ingest_raw_lines(file_path: Path) -> pd.DataFrame:
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            lines = [l.strip() for l in fh if l.strip()]

        if not lines:
            return pd.DataFrame()

        sample = lines[0]

        for sep in [",", ";", "\t", "|"]:
            if sep in sample:
                split_rows = [row.split(sep) for row in lines]

                max_len = max(len(r) for r in split_rows)

                normalized = [
                    r + [""] * (max_len - len(r))
                    for r in split_rows
                ]

                headers = [str(h).strip().lower() for h in normalized[0]]

                return pd.DataFrame(normalized[1:], columns=headers)

        return pd.DataFrame({"_raw": lines})

    except Exception:
        return pd.DataFrame()
    

# =============================================================================
# FILE: app/services/ingestion_profiler.py
# LAYER 2 — PROFILING (DATA UNDERSTANDING)
# =============================================================================
from typing import Any, Dict

import pandas as pd

_SAMPLE_LIMIT = 50

def profile_dataframe(df: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    """Profiles columns using a sample. Does not make decisions."""
    metrics: Dict[str, Dict[str, float]] = {}
    if df.empty:
        return metrics

    sample = df.head(_SAMPLE_LIMIT)
    total = len(sample)

    for col in df.columns:
        metrics[col] = _profile_column(sample[col], total)
    return metrics

def _profile_column(series: pd.Series, total: int) -> Dict[str, float]:
    non_null_mask = series.notna() & (series.astype(str).str.strip() != "") & (~series.astype(str).str.lower().isin({"nan", "null", "none", "n/a", ""}))
    valid_series = series[non_null_mask]
    count = len(valid_series)

    if count == 0:
        return {"non_null_ratio": 0.0, "unique_ratio": 0.0, "avg_length": 0.0, "numeric_parse_ratio": 0.0}

    unique_ratio = valid_series.nunique() / count
    avg_len = float(valid_series.astype(str).str.len().mean())

    parsed_count = 0
    for val in valid_series:
        if _is_numeric_candidate(str(val)):
            parsed_count += 1

    return {
        "non_null_ratio": count / total if total > 0 else 0.0,
        "unique_ratio": unique_ratio,
        "avg_length": avg_len,
        "numeric_parse_ratio": parsed_count / count,
    }

def _is_numeric_candidate(text: str) -> bool:
    cleaned = re.sub(r"[^\d.,\-+eE]", "", text)
    if not cleaned or cleaned in {".", ",", "-"}:
        return False
    try:
        float(cleaned.replace(",", "."))
        return True
    except ValueError:
        return False


# =============================================================================
# FILE: app/services/schema_inference.py
# LAYER 3 — SCHEMA INFERENCE (CORE INTELIGENTE)
# =============================================================================
from typing import Dict, Optional

import pandas as pd



def infer_schema(df: pd.DataFrame) -> Dict[str, Optional[str]]:
    """Infers ID and Amount columns using relative ranking only."""
    profile = profile_dataframe(df)
    if not profile:
        return {"id_column": None, "amount_column": None}

    # Ranking-based selection
    id_scores = {col: _score_id(col, m) for col, m in profile.items()}
    amount_scores = {col: _score_amount(col, m) for col, m in profile.items()}

    # ALWAYS pick best ID. If profile exists, this will never be None.
    best_id = max(id_scores, key=id_scores.get)

    # Optional amount: pick best, exclude if it collides with ID
    best_amount = max(amount_scores, key=amount_scores.get)
    if best_amount == best_id:
        best_amount = None

    return {"id_column": best_id, "amount_column": best_amount}

def _score_id(col_name: str, m: Dict[str, float]) -> float:
    nn = m["non_null_ratio"]
    uniq = m["unique_ratio"]
    avg_len = m["avg_length"]

    base_score = (nn * 0.4) + (uniq * 0.4)
    
    col_str = str(col_name).lower()
    if "id" in col_str or "order" in col_str or "pedido" in col_str:
        base_score += 0.5
    if "amount" in col_str or "monto" in col_str or "total" in col_str:
        base_score -= 0.5

    # Penalización por longitud (crítica)
    if avg_len > 60:
        length_factor = 0.3
    elif avg_len > 40:
        length_factor = 0.5
    elif avg_len < 3:
        length_factor = 0.6
    else:
        length_factor = 1.0

    return base_score * length_factor

def _score_amount(col_name: str, m: Dict[str, float]) -> float:
    # Relative scoring: numeric parse ratio dominates
    base_score = m["numeric_parse_ratio"]
    
    col_str = str(col_name).lower()
    if "amount" in col_str or "monto" in col_str or "total" in col_str:
        base_score += 0.5
        
    return base_score


# =============================================================================
# FILE: app/services/normalization.py
# LAYER 4 — NORMALIZATION (NO DESTRUCTIVA)
# =============================================================================
import re
from typing import Optional, Any

import pandas as pd

def normalize_data(df: pd.DataFrame, id_col: str, amount_col: Optional[str]) -> pd.DataFrame:
    """Creates internal signal columns. NEVER drops rows."""
    norm = df.copy()
    
    # Extraer los datos primero ANTES de sobreescribir la columna normalizada final (en caso de que coincidan los nombres)
    raw_ids = pd.Series(None, index=norm.index, dtype=object)
    raw_amounts = pd.Series(None, index=norm.index, dtype=object)
    
    if id_col and id_col in norm.columns:
        raw_ids = norm[id_col].copy()
        
    if amount_col and amount_col in norm.columns:
        raw_amounts = norm[amount_col].copy()
        
    norm["order_id"] = None
    norm["valid_id"] = False
    norm["amount"] = None
    norm["valid_amount"] = False

    if id_col and id_col in norm.columns:
        raw_ids = raw_ids.astype(str).str.strip()
        norm["order_id"] = raw_ids.str.lower()
        noise = {"", "nan", "null", "none", "n/a"}
        norm["valid_id"] = (~raw_ids.str.lower().isin(noise)) & (raw_ids != "")

    if amount_col and amount_col in norm.columns:
        norm["amount"] = raw_amounts.apply(_robust_parse_amount)
        norm["valid_amount"] = norm["amount"].notna()

    return norm

def _robust_parse_amount(value: Any) -> Optional[float]:
    if pd.isna(value):
        return None
    text = str(value).strip().lower()
    if text in {"", "nan", "null", "none", "n/a"}:
        return None

    is_negative = text.startswith("(") and text.endswith(")")
    if is_negative:
        text = text[1:-1]

    # Strip currency/text, keep numeric chars
    text = re.sub(r"[^\d.,\-+eE]", "", text)
    if not text or text in {".", ",", "-"}:
        return None

    # Separator disambiguation
    has_dot = "." in text
    has_comma = "," in text

    if has_dot and has_comma:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif has_comma and not has_dot:
        parts = text.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            text = text.replace(",", ".")
        else:
            text = text.replace(",", "")

    try:
        val = float(text)
        return -val if is_negative else val
    except ValueError:
        return None


# =============================================================================
# FILE: app/services/extraction.py
# LAYER 5 — EXTRACTION (SIGNAL READY)
# =============================================================================
from typing import Any, Dict, List

import pandas as pd

def extract_signals(df: pd.DataFrame) -> Dict[str, Any]:
    """Extracts structured datasets. Outputs ONLY signal-relevant fields."""
    if df.empty:
        return _empty_contract()

    valid_mask = df.get("valid_id", pd.Series(False, index=df.index))
    amount_mask = df.get("valid_amount", pd.Series(False, index=df.index))

    valid_idx = df.index[valid_mask]
    ventas_idx = valid_idx[amount_mask.loc[valid_idx]]

    ventas = _format_rows(df.loc[ventas_idx], ["order_id", "amount"])
    facturas = _format_rows(df.loc[valid_idx], ["order_id", "amount"])

    doc_type = "ventas" if len(ventas) > 0 else "facturas"

    return {
        "ventas": ventas,
        "facturas": facturas,
        "valid_rows": int(valid_mask.sum()),
        "total_rows": int(len(df)),
        "document_type": doc_type,
    }

def _format_rows(subset: pd.DataFrame, cols: List[str]) -> List[Dict[str, Any]]:
    result = []
    for row in subset[cols].to_dict(orient="records"):
        result.append({
            "order_id": str(row.get("order_id", "")),
            "amount": float(row["amount"]) if pd.notna(row.get("amount")) else None
        })
    return result

def _empty_contract() -> Dict[str, Any]:
    return {"ventas": [], "facturas": [], "valid_rows": 0, "total_rows": 0, "document_type": "facturas"}


# =============================================================================
# FILE: app/services/ingestion_pipeline.py
# LAYER 6 — PIPELINE ORCHESTRATOR
# =============================================================================
from pathlib import Path
from typing import Dict, Any



def run_ingestion_pipeline(file_path: Path) -> Dict[str, Any]:
    """
    Single entry point. Orchestrates ingestion layers.
    NEVER raises exception outward. ALWAYS returns consistent contract.
    """
    _fallback = {"ventas": [], "facturas": [], "valid_rows": 0, "total_rows": 0, "document_type": "facturas"}
    try:
        df = load_file(file_path)
        if df.empty:
            return _fallback

        schema = infer_schema(df)
        id_col = schema.get("id_column")
        amount_col = schema.get("amount_column")

        # Invariant: If loader succeeded but inference found nothing, pick safest fallback
        if not id_col:
            id_col = str(df.columns[0]) if len(df.columns) > 0 else None
        if not id_col:
            return _fallback

        normalized = normalize_data(df, id_col, amount_col)
        return extract_signals(normalized)

    except Exception:
        # Absolute safety net
        return _fallback