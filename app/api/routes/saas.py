from __future__ import annotations

import os
import shutil
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from app.core.time_provider import get_current_timestamp
from app.services.findings_engine import build_findings
from app.services.ingestion_persistence import persist_ingestion, update_global_index
from app.services.scoring import compute_priority
from app.services.ingestion_loader import run_ingestion_pipeline
from app.services.orchestrator.run_pipeline import run_pipeline as run_orchestrator_pipeline
from app.modules.registry_loader import load_modules_registry


router = APIRouter(prefix="/saas", tags=["saas"])
_TMP_ROOT = Path("/tmp")
_FALLBACK_TMP_ROOT = Path("data/tmp")

HUMAN_SIGNALS: dict[str, str] = {
    "order_missing_in_documents": "Faltan datos para algunas operaciones",
    "duplicate_order": "Hay operaciones registradas más de una vez",
    "order_mismatch": "Hay operaciones que no coinciden entre los archivos",
}

SUGGESTED_ACTIONS_BY_SIGNAL: dict[str, str] = {
    "order_mismatch": "Revisar inconsistencia en la orden.",
    "order_missing_in_documents": "Solicitar documentación faltante.",
    "duplicate_order": "Verificar posible duplicado de orden.",
}


def _create_request_dir(ingestion_id: str) -> Path:
    primary = _TMP_ROOT / ingestion_id
    try:
        primary.mkdir(parents=True, exist_ok=True)
        return primary
    except Exception:
        fallback = _FALLBACK_TMP_ROOT / ingestion_id
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def _get_templates() -> Jinja2Templates | None:
    try:
        return Jinja2Templates(directory="app/api/templates")
    except AssertionError:
        return None


def is_debug_enabled(request: Request) -> bool:
    if str(os.environ.get("SMARTBRIDGE_DEBUG", "")).lower() in ("true", "1", "yes"):
        return True
    if request.query_params.get("debug") == "1":
        return True
    return False


def _save_upload(upload: UploadFile, target: Path) -> None:
    with target.open("wb") as out:
        shutil.copyfileobj(upload.file, out)


def _render_saas_form(request: Request, error: str | None = None, status_code: int = 200) -> HTMLResponse:
    templates = _get_templates()
    if templates is None:
        html = """
        <html>
        <head><title>SmartBridge SaaS</title></head>
        <body>
            <h1>SmartBridge SaaS</h1>
            {error_block}
            <form method="post" action="/saas/upload" enctype="multipart/form-data">
                Archivo: <input type="file" name="file" />
                <button type="submit">Procesar</button>
            </form>
        </body>
        </html>
        """
        error_block = f"<div class='error'>{error}</div>" if error else ""
        return HTMLResponse(content=html.format(error_block=error_block), status_code=status_code)

    return templates.TemplateResponse(
        request=request,
        name="saas.html",
        context={"error": error},
        status_code=status_code,
    )


def _render_result(request: Request, context: dict[str, Any]) -> HTMLResponse:
    templates = _get_templates()
    if templates is None:
        issues = "".join(
            f"<div>{s['signal_code']} en {s['entity_ref']} (priority={s['priority']}, group={s['group']})</div>"
            for s in context["signals"]
        )
        actions = "".join(f"<div>{a}</div>" for a in context["suggested_actions"])
        html = f"""
        <html>
        <head><title>Resultado de procesamiento</title></head>
        <body>
            <h1>Resultado de procesamiento</h1>
            <p>Ingestion ID: {context['ingestion_id']}</p>
            <p>Total signals: {context['total_signals']}</p>
            <h2>Issues</h2>
            {issues}
            <h2>Suggested Actions</h2>
            {actions}
            <a href="/saas">[Volver]</a>
        </body>
        </html>
        """
        return HTMLResponse(content=html)

    return templates.TemplateResponse(
        request=request,
        name="result.html",
        context=context,
    )


def _build_signals(ventas: list[dict[str, Any]], facturas: list[dict[str, str]]) -> list[dict[str, str]]:
    ventas_ids = [v["order_id"] for v in ventas]
    facturas_ids = {f["order_id"] for f in facturas}

    missing_signals = [
        {"signal_code": "order_missing_in_documents", "entity_ref": f"order_{order_id}",
         "human_message": HUMAN_SIGNALS.get("order_missing_in_documents", "Hay una inconsistencia en tus datos")}
        for order_id in sorted(set(ventas_ids) - facturas_ids)
    ]

    seen: set[str] = set()
    dup: set[str] = set()
    for order_id in ventas_ids:
        if order_id in seen:
            dup.add(order_id)
        else:
            seen.add(order_id)

    duplicate_signals = [
        {"signal_code": "duplicate_order", "entity_ref": f"order_{order_id}",
         "human_message": HUMAN_SIGNALS.get("duplicate_order", "Hay una inconsistencia en tus datos")}
         for order_id in sorted(dup)
    ]

    signals = missing_signals + duplicate_signals
    signals.sort(key=lambda s: (s["signal_code"], s["entity_ref"]))
    return signals


@router.get("", response_class=HTMLResponse)
def saas_home(request: Request) -> HTMLResponse:
    return _render_saas_form(request=request, error=None)


@router.post("/upload")
async def saas_upload(
    request: Request,
    file: UploadFile | None = File(None),
    ventas_file: UploadFile | None = File(None),
    facturas_file: UploadFile | None = File(None),
) -> Any:
    print("🔥 ENTERED /saas/upload")
    debug_mode = is_debug_enabled(request)
    debug_trail: list[dict[str, Any]] | None = [] if debug_mode else None

    try:
        single_mode = file is not None and ventas_file is None and facturas_file is None
        legacy_mode = file is None and ventas_file is not None and facturas_file is not None

        print("single_mode value:", single_mode)
        print("legacy_mode value:", legacy_mode)

        if not single_mode and not legacy_mode:
            raise ValueError("Debés enviar un archivo (file) o el par legacy (ventas_file + facturas_file).")

        ingestion_id = uuid.uuid4().hex
        _create_request_dir(ingestion_id)

        if single_mode:
            print("📂 Processing single file upload")
            assert file is not None
            request_dir = _create_request_dir(ingestion_id)
            single_path = request_dir / (file.filename or "upload.csv")
            _save_upload(file, single_path)

            ingestion_result = run_ingestion_pipeline(single_path)
            ventas = ingestion_result["ventas"]
            facturas = ingestion_result["facturas"]
            valid_rows = ingestion_result["valid_rows"]
            total_raw_rows = ingestion_result["total_rows"]
            doc_type = "upload"
            single_meta = persist_ingestion(
                ingestion_id,
                single_path,
                ventas + facturas,
                {},
                "upload",
            ) or {}
            v_meta: dict[str, Any] = single_meta
            f_meta: dict[str, Any] = single_meta
            generated_signals = _build_signals(ventas, facturas)

        else:
            assert ventas_file is not None and facturas_file is not None
            doc_type = "combined"
            request_dir = _FALLBACK_TMP_ROOT / ingestion_id
            request_dir.mkdir(parents=True, exist_ok=True)
            ventas_path = request_dir / (ventas_file.filename or "ventas.csv")
            facturas_path = request_dir / (facturas_file.filename or "facturas.csv")

            _save_upload(ventas_file, ventas_path)
            _save_upload(facturas_file, facturas_path)

            res_v = run_ingestion_pipeline(ventas_path)
            res_f = run_ingestion_pipeline(facturas_path)

            ventas = res_v["ventas"]
            facturas = res_f["facturas"]
            valid_rows = res_v["valid_rows"] + res_f["valid_rows"]
            total_raw_rows = res_v["total_rows"] + res_f["total_rows"]

            v_meta = persist_ingestion(ingestion_id, ventas_path, ventas, {}, "ventas") or {}
            f_meta = persist_ingestion(ingestion_id, facturas_path, facturas, {}, "facturas") or {}
            generated_signals = _build_signals(ventas, facturas)

        # Bloqueo temprano si no hay datos válidos
        if valid_rows == 0:
            return _render_result(
                request=request,
                context={
                    "ingestion_id": ingestion_id,
                    "document_type": doc_type,
                    "total_signals": 0,
                    "signals": [],
                    "suggested_actions": [],
                    "total_raw_rows": total_raw_rows,
                    "valid_rows": 0,
                    "discarded_rows": total_raw_rows,
                    "trust_level": "BAJO",
                    "has_data_issues": True,
                    "has_signals": False,
                    "empty_result": True,
                    "empty_message": "No pudimos interpretar el archivo. Probá con otro formato o revisá que tenga columnas con datos.",
                },
            )

        timestamp = get_current_timestamp()
        orchestration_result = run_orchestrator_pipeline(
            findings=generated_signals,
            tenant_id="test_tenant",
            source_module="saas_upload",
            ingestion_id=ingestion_id,
            correlation_id=ingestion_id,
            timestamp=timestamp,
            previous_signals=[],
        )

        signals = orchestration_result["signals"]
        suggested_actions: list[str] = [
            HUMAN_SIGNALS.get(
                str(signal.get("signal_code", "")),
                "Revisar señal detectada.",
            )
            for signal in signals
        ]

        try:
            v_q = v_meta.get("quality_score", 1.0)
            v_r = v_meta.get("risk_score", 0.0)
            f_q = f_meta.get("quality_score", 1.0)
            f_r = f_meta.get("risk_score", 0.0)

            overall_quality = min(v_q, f_q)
            overall_risk = max(v_r, f_r)
            priority = compute_priority(overall_quality, overall_risk)

            update_global_index(
                {
                    "ingestion_id": ingestion_id,
                    "timestamp": timestamp,
                    "total_signals": len(signals),
                    "document_type": doc_type,
                    "priority": priority,
                    "quality_score": overall_quality,
                }
            )
        except Exception:
            pass

        if debug_mode:
            return JSONResponse(
                {
                    "ingestion_id": ingestion_id,
                    "debug": debug_trail,
                    "signals": generated_signals,
                    "orchestration": orchestration_result,
                }
            )

        discarded_rows = max(0, total_raw_rows - valid_rows)
        ratio = valid_rows / max(1, total_raw_rows)
        if ratio >= 0.8:
            trust_level = "ALTO"
        elif ratio >= 0.5:
            trust_level = "MEDIO"
        else:
            trust_level = "BAJO"

        return _render_result(
            request=request,
            context={
                "ingestion_id": ingestion_id,
                "document_type": doc_type,
                "total_signals": len(signals),
                "signals": signals,
                "suggested_actions": suggested_actions,
                "total_raw_rows": total_raw_rows,
                "valid_rows": valid_rows,
                "discarded_rows": discarded_rows,
                "trust_level": trust_level,
                "has_data_issues": discarded_rows > 0,
                "has_signals": len(signals) > 0,
            },
        )
    except Exception as exc:
        import logging
        logging.getLogger("smartbridge").error("saas_upload error: %s", exc, exc_info=True)

        human_error = "No pudimos procesar el archivo. Revisá que el formato sea correcto (CSV o Excel con columnas de pedidos)."
        if debug_mode:
            return JSONResponse(
                {
                    "error": str(exc)
                },
                status_code=400,
            )

        return _render_saas_form(
            request=request,
            error=human_error,
            status_code=400,
        )


@router.get("/ingestions")
def list_ingestions() -> JSONResponse:
    try:
        from app.services.ingestion_persistence import _INGESTIONS_ROOT
        import json
        index_file = _INGESTIONS_ROOT / "index.json"
        if not index_file.exists():
            return JSONResponse({"ingestions": []})
        with index_file.open("r", encoding="utf-8") as f:
            data = json.load(f)
            priority_map = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
            data.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
            data.sort(key=lambda x: priority_map.get(x.get("priority", "LOW"), 3))
            return JSONResponse({"ingestions": data})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/ingestions/{ingestion_id}")
def get_ingestion(ingestion_id: str) -> JSONResponse:
    try:
        from app.services.ingestion_persistence import _INGESTIONS_ROOT
        import json
        target_dir = _INGESTIONS_ROOT / ingestion_id
        if not target_dir.exists():
            return JSONResponse({"error": "Ingestion not found"}, status_code=404)

        result = {"ingestion_id": ingestion_id}
        for sub in ["ventas", "facturas"]:
            meta_file = target_dir / sub / "metadata.json"
            if meta_file.exists():
                with meta_file.open("r", encoding="utf-8") as f:
                    result[sub] = json.load(f)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/modules")
def read_modules_registry() -> JSONResponse:
    try:
        registry_path = "docs/product/modules/modules_registry_v1.json"
        result = load_modules_registry(registry_path)
        
        status_code = 500 if result.get("validation_errors") else 200
        return JSONResponse(result, status_code=status_code)
        
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

