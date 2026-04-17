from app.services.supabase_client import get_supabase

def log_event(lead_id: str, telegram_chat_id: str | int, role: str, message_text: str, event_type: str) -> None:
    supabase = get_supabase()
    supabase.table("dialogue_events").insert({
        "lead_id": lead_id,
        "telegram_chat_id": telegram_chat_id,
        "role": role,
        "message_text": message_text,
        "event_type": event_type
    }).execute()
    return None
