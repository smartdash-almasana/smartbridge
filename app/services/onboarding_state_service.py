from datetime import UTC, datetime
from typing import Any

from app.services.supabase_client import get_supabase


def set_onboarding_state(
    lead_id: str,
    current_step: str,
    file_uploaded: bool = False,
    completed: bool = False,
) -> None:
    supabase = get_supabase()
    supabase.table("onboarding_state").upsert(
        {
            "lead_id": lead_id,
            "current_step": current_step,
            "file_uploaded": file_uploaded,
            "completed": completed,
            "updated_at": datetime.now(UTC).isoformat(),
        },
        on_conflict="lead_id",
    ).execute()
    return None


def get_onboarding_state(lead_id: str) -> dict[str, Any] | None:
    supabase = get_supabase()
    res = (
        supabase.table("onboarding_state")
        .select("*")
        .eq("lead_id", lead_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None
