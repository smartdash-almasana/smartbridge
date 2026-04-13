import os
from datetime import datetime


def get_current_timestamp() -> str:
    fixed = os.getenv("FIXED_TIMESTAMP", "").strip()
    if fixed:
        return fixed
    return datetime.utcnow().isoformat() + "Z"
