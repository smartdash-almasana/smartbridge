import json
from pathlib import Path
from typing import Any
from app.core.time_provider import get_current_timestamp
from app.services.scoring import compute_quality_score, compute_risk_score, compute_priority

_INGESTIONS_ROOT = Path("data/ingestions")

def persist_ingestion(
    ingestion_id: str,
    df_original: Any,
    normalized_data: list[dict[str, Any]],
    mapping: dict[str, str],
    subfolder: str = ""
) -> None:
    """
    Persists the original input, normalized data, and mapping metadata
    for reproducibility and auditing without throwing errors (silent fail).
    """
    try:
        target_dir = _INGESTIONS_ROOT / ingestion_id
        if subfolder:
            target_dir = target_dir / subfolder
            
        target_dir.mkdir(parents=True, exist_ok=True)
        
        # Guardar CSV original limpio
        if isinstance(df_original, Path) and df_original.exists():
            import shutil
            shutil.copy2(df_original, target_dir / "input.csv")
        elif hasattr(df_original, "to_csv"):
            df_original.to_csv(target_dir / "input.csv", index=False)
            
        # Guardar diccionario normalizado
        with (target_dir / "normalized.json").open("w", encoding="utf-8") as f:
            json.dump(normalized_data, f, ensure_ascii=False, indent=2)
            
        quality = compute_quality_score(df_original, mapping)
        risk = compute_risk_score(normalized_data)
        priority = compute_priority(quality, risk)
            
        # Metadata de transmutación
        metadata = {
            "ingestion_id": ingestion_id,
            "timestamp": get_current_timestamp(),
            "row_count": len(normalized_data),
            "columns_detected": list(df_original.columns) if hasattr(df_original, "columns") else [],
            "mapping": mapping,
            "quality_score": quality,
            "risk_score": risk,
            "priority": priority
        }
        with (target_dir / "metadata.json").open("w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
            
        return metadata
            
    except Exception:
        return {}


def update_global_index(ingestion_data: dict[str, Any]) -> None:
    """Consolida un objeto de resumen de la transacción dentro del índice global"""
    try:
        _INGESTIONS_ROOT.mkdir(parents=True, exist_ok=True)
        index_path = _INGESTIONS_ROOT / "index.json"
        
        try:
            if index_path.exists():
                with index_path.open("r", encoding="utf-8") as f:
                    index = json.load(f)
            else:
                index = []
        except Exception:
            index = []
            
        # Inyecta siempre de recien a viejo (inicio del array)
        index.insert(0, ingestion_data)
        
        with index_path.open("w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
            
    except Exception:
        pass
