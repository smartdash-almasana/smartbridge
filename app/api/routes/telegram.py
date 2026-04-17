import json
import os
from typing import Any
from urllib import error, parse, request

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services.dialogue_service import log_event
from app.services.leads_service import get_lead_by_token, link_telegram
from app.services.onboarding_state_service import get_onboarding_state, set_onboarding_state
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/telegram", tags=["telegram"])


def send_message(chat_id: str, text: str) -> None:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not bot_token:
        return

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
    req = request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req):
            pass
    except error.URLError:
        return


def _get_lead_by_chat_id(telegram_chat_id: str) -> dict[str, Any] | None:
    supabase = get_supabase()
    res = (
        supabase.table("leads")
        .select("*")
        .eq("telegram_chat_id", telegram_chat_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def handle_start(message: dict[str, Any]) -> None:
    text = message.get("text", "")
    parts = text.strip().split(maxsplit=1)

    token = parts[1] if len(parts) > 1 else None

    chat_id = str(message["chat"]["id"])
    user_id = str(message["from"]["id"])
    username = message["from"].get("username")

    if not token:
        send_message(chat_id, "Para empezar, entrá desde la web.")
        return

    lead = get_lead_by_token(token)

    if not lead:
        send_message(chat_id, "Este enlace no es válido o venció.")
        return

    link_telegram(
        lead_id=lead["lead_id"],
        tg_user_id=user_id,
        tg_chat_id=chat_id,
        username=username,
    )

    log_event(lead["lead_id"], chat_id, "user", text, "message")

    send_message(chat_id, f"Hola {lead.get('name', '')}, soy Hermes.\n\n¿Querés ver si estás perdiendo plata sin darte cuenta?")
    set_onboarding_state(lead["lead_id"], "awaiting_first_onboarding_answer")


def handle_message(message: dict[str, Any]) -> None:
    text = message.get("text", "")
    if text.startswith("/start"):
        handle_start(message)
        return

    chat_id = str(message["chat"]["id"])
    lead = _get_lead_by_chat_id(chat_id)
    if not lead:
        return

    log_event(lead["lead_id"], chat_id, "user", text, "message")
    state = get_onboarding_state(lead["lead_id"])

    if state and state.get("current_step") == "awaiting_first_onboarding_answer":
        set_onboarding_state(
            lead["lead_id"],
            "onboarding_answer_received",
            file_uploaded=bool(state.get("file_uploaded", False)),
            completed=bool(state.get("completed", False)),
        )
        send_message(
            chat_id,
            "Perfecto. Con eso ya empecé a conocerte mejor.\n\nAhora mandame tu primera fuente de datos: puede ser un Excel o una planilla de Google Sheets.",
        )


@router.post("/webhook")
async def telegram_webhook(update: dict[str, Any]) -> JSONResponse:
    message = update.get("message")
    if not message:
        return JSONResponse({"ok": True})

    handle_message(message)
    return JSONResponse({"ok": True})
