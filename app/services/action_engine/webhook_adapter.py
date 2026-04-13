import json
import os
import time
from urllib import request


def send_webhook(payload: dict) -> dict[str, str]:
    webhook_url = os.getenv("WEBHOOK_URL", "").strip()
    if not webhook_url:
        return {"status": "skipped"}

    max_attempts = 3
    delays = (0.1, 0.3)
    body = json.dumps(payload).encode("utf-8")

    for attempt in range(max_attempts):
        try:
            req = request.Request(
                url=webhook_url,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with request.urlopen(req, timeout=2):
                pass
            return {"status": "sent"}
        except Exception:
            if attempt == max_attempts - 1:
                return {"status": "failed"}
            time.sleep(delays[attempt])
