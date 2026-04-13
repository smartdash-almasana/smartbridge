"""
column_mapper.py
Normaliza y mapea headers reales de archivos CSV/Excel
al esquema canónico de SmartBridge.

Reglas:
- determinista: mismo input → mismo output
- fail-fast: si un campo canónico obligatorio no puede resolverse → ValueError
- sin efectos secundarios
"""

from __future__ import annotations
import re
import unicodedata
from typing import Any

# ---------------------------------------------------------------------------
# Esquema canónico y diccionario de sinónimos
# ---------------------------------------------------------------------------

COLUMN_SYNONYMS: dict[str, list[str]] = {
    "order_id": [
        "order_id",
        "orderid",
        "order id",
        "id",
        "orden_id",
        "pedido_id",
        "pedido",
        "nro_pedido",
        "numero_pedido",
    ],
    "amount": [
        "amount",
        "monto",
        "price",
        "total",
        "importe",
        "valor",
        "price_total",
    ],
}


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _normalize_key(col: str) -> str:
    """Normaliza un string de columna para comparación sin ambigüedad."""
    col = col.strip().lower()

    # remover acentos
    col = unicodedata.normalize("NFKD", col)
    col = "".join(c for c in col if not unicodedata.combining(c))

    # reemplazar separadores por _
    col = re.sub(r"[^\w]+", "_", col)

    # limpiar duplicados _
    col = re.sub(r"_+", "_", col)

    return col.strip("_")


# Índice invertido: variante_normalizada → campo_canónico
# Se construye una sola vez al importar (determinista).
_REVERSE_INDEX: dict[str, str] = {
    _normalize_key(variant): canonical
    for canonical, variants in COLUMN_SYNONYMS.items()
    for variant in variants
}


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------

def resolve_column(raw_header: str) -> str | None:
    """
    Devuelve el nombre canónico para un header crudo, o None si no hay match.

    Determinista: mismo input → mismo output.
    Sin side effects.
    """
    return _REVERSE_INDEX.get(_normalize_key(raw_header))


def build_column_map(
    headers: list[str],
    required: list[str] | None = None,
) -> dict[str, str]:
    """
    Recibe la lista de headers crudos y devuelve un mapping
    { canonical_field: raw_header } para los campos que matchean.

    Si `required` está definido y algún campo no puede resolverse,
    lanza ValueError (fail-fast).

    Args:
        headers:  Lista de nombres de columna tal como aparecen en el archivo.
        required: Campos canónicos que deben existir obligatoriamente.

    Returns:
        dict{ canonical → raw_header_original }

    Raises:
        ValueError: Si algún campo requerido no puede resolverse.
    """
    mapping: dict[str, str] = {}
    for raw in headers:
        canonical = resolve_column(raw)
        if canonical is not None and canonical not in mapping:
            mapping[canonical] = raw

    if required:
        missing = [f for f in required if f not in mapping]
        if missing:
            readable = ", ".join(missing)
            raise ValueError(
                f"Columnas requeridas no encontradas: {readable}. "
                f"Headers recibidos: {headers}"
            )

    return mapping


def rename_dataframe_columns(df: object, mapping: dict[str, str]) -> object:
    """
    Renombra las columnas de un DataFrame usando el mapping
    { canonical → raw_header } producido por build_column_map.

    Sólo renombra columnas presentes en el mapping; el resto no se toca.

    Args:
        df:      pandas DataFrame.
        mapping: Resultado de build_column_map.

    Returns:
        DataFrame con columnas renombradas a sus nombres canónicos.
    """
    # Invertir: raw_header → canonical
    rename_map = {raw: canonical for canonical, raw in mapping.items()}
    return df.rename(columns=rename_map)

def parse_amount(value: Any) -> float | None:
    if value is None:
        return None

    s = str(value).strip()

    if not s:
        return None

    negative = False

    if s.startswith("(") and s.endswith(")"):
        negative = True
        s = s[1:-1]

    if "-" in s:
        negative = True
        s = s.replace("-", "")

    s = re.sub(r"[^\d,.\s]", "", s)
    s = s.replace(" ", "")

    last_punct_idx = max(s.rfind("."), s.rfind(","))
    if last_punct_idx != -1:
        decimals_len = len(s) - last_punct_idx - 1
        if decimals_len == 3:
            s = s.replace(".", "").replace(",", "")
        else:
            s = s[:last_punct_idx].replace(".", "").replace(",", "") + "." + s[last_punct_idx + 1:]

    try:
        val = float(s)
    except:
        return None

    return -val if negative else val

def build_debug_snapshot(df: Any, mapping: dict[str, str], stage: str) -> dict[str, Any]:
    """Generates a structured dictionary containing a snapshot of the DataFrame state."""
    return {
        "stage": stage,
        "columns_detected": list(df.columns) if df is not None else [],
        "mapping": dict(mapping),
        "row_count": len(df) if df is not None else 0,
        "sample_rows": df.head(3).to_dict(orient="records") if df is not None else [],
    }
