from fastapi import FastAPI
from typing import Any
from app.run_pipeline import run_pipeline

app = FastAPI()

@app.get("/")
def health() -> dict[str, str]:
    return {"status": "ok"}

@app.post("/run")
def run() -> dict[str, Any]:
    result = run_pipeline("tenant_1")
    return {"result": result}
