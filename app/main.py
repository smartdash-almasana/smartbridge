import sqlite3
from fastapi import FastAPI
from typing import Any

from app.run_pipeline import run_pipeline
from app.api.routes.telegram import router as telegram_router
from app.api.routes.saas import router as saas_router
from app.api.routes.landing import router as landing_router
from app.api.routes.entity import router as entity_router
from app.api.server import router as pipeline_router
from app.api.routes.clarifications import router as clarifications_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.actions import router as actions_router

from app.services.signals.lifecycle_persistence import register_database_upsert_signal
from app.services.signals.close_signal import register_database_close_signal
from app.services.action_engine.action_persistence import persist_action
import app.services.signals.batch_processor as bp

# ---------------------------------------------------------------------------
# Runtime tool registry — wires batch_processor to SQLite at startup
# ---------------------------------------------------------------------------
_conn = sqlite3.connect("app.db", check_same_thread=False)

_tools: dict = {}
register_database_upsert_signal(_tools, _conn)
register_database_close_signal(_tools, _conn)
_tools["database.persist_action"] = lambda payload: persist_action(_conn, payload)

bp.mcp_execute = lambda name, payload: _tools[name](payload)
bp.dispatch = None  # use execute_action_from_signal default inside batch_processor

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI()
app.include_router(landing_router)
app.include_router(telegram_router)
app.include_router(saas_router)
app.include_router(entity_router)
app.include_router(pipeline_router)
app.include_router(clarifications_router)
app.include_router(jobs_router)
app.include_router(actions_router)


@app.post("/run")
def run() -> dict[str, Any]:
    result = run_pipeline("tenant_1")
    return {"result": result}
