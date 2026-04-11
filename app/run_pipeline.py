from typing import Any

def run_pipeline(tenant_id: str) -> dict[str, Any]:
    return {
        "status": "ok",
        "tenant_id": tenant_id,
        "message": "pipeline stub running"
    }
