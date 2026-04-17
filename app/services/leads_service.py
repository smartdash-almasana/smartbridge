import uuid
from datetime import UTC, datetime
from typing import Any
from app.services.supabase_client import get_supabase

def create_lead(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = dict(payload) if payload else {}
    
    supabase = get_supabase()
    data["lead_id"] = str(uuid.uuid4())
    data["telegram_link_token"] = str(uuid.uuid4())
    data["status"] = "pending_telegram_link"

    supabase.table("leads").insert(data).execute()
    return data

def get_lead_by_token(token: str) -> dict[str, Any] | None:
    supabase = get_supabase()
    res = (
        supabase.table("leads")
        .select("*")
        .eq("telegram_link_token", token)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None

def link_telegram(lead_id: str, tg_user_id: str | int, tg_chat_id: str | int, username: str | None = None) -> None:
    supabase = get_supabase()
    supabase.table("leads").update({
        "telegram_user_id": tg_user_id,
        "telegram_chat_id": tg_chat_id,
        "telegram_username": username,
        "status": "telegram_linked",
        "telegram_linked_at": datetime.now(UTC).isoformat()
    }).eq("lead_id", lead_id).execute()