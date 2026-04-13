from typing import Any

from fastapi import APIRouter

from app.services.telegram.loop import handle_telegram_update


router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.post("/webhook")
def telegram_webhook(update: dict[str, Any]) -> dict[str, Any]:
    return handle_telegram_update(update)
