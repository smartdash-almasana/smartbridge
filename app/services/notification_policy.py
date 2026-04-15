"""Notification Policy v1 — anti-noise layer for outbound notifications.

Rules applied in order:
1. Only ``alta`` and ``media`` urgencies are eligible (``baja`` → skipped).
2. Channel caps per run:
       telegram → max 2
       email    → max 3
3. Intra-run deduplication: same ``summary`` + ``channel`` pair is sent once.
4. Overall ``limit`` is an outer bound on candidates considered (caller-provided).

Contract:
    apply_notification_policy(
        priority_items: list[dict[str, Any]],
        limit: int,
    ) -> dict[str, Any]

Output:
    {
        "selected_by_channel": {
            "telegram": list[dict],
            "email":    list[dict],
        },
        "skipped": [
            {"reason": str, "item": dict},
        ],
    }

No side-effects. No new tables. No external calls.
"""
from __future__ import annotations

from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ELIGIBLE_URGENCIES: frozenset[str] = frozenset({"alta", "media"})

# Channel assigned to each eligible urgency (mirrors orchestrator's _CHANNEL_MAP).
_CHANNEL_FOR_URGENCY: dict[str, str] = {
    "alta": "telegram",
    "media": "email",
}

# Per-run hard caps by channel.
_CHANNEL_CAPS: dict[str, int] = {
    "telegram": 2,
    "email": 3,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def apply_notification_policy(
    priority_items: list[dict[str, Any]],
    limit: int,
) -> dict[str, Any]:
    """Apply anti-noise policy and return selected items grouped by channel.

    Args:
        priority_items: ordered list from inbox (highest priority first).
        limit:          outer bound — at most this many candidates are considered.

    Returns:
        dict with ``selected_by_channel`` and ``skipped``.

    Raises:
        ValueError: if ``limit`` is not a positive integer.
    """
    if not isinstance(limit, int) or limit <= 0:
        raise ValueError("limit must be a positive integer")
    if not isinstance(priority_items, list):
        raise ValueError("priority_items must be a list")

    candidates = priority_items[:limit]

    selected_by_channel: dict[str, list[dict[str, Any]]] = {
        "telegram": [],
        "email": [],
    }
    skipped: list[dict[str, Any]] = []
    seen_dedup: set[str] = set()          # "summary|channel"
    channel_counts: dict[str, int] = {"telegram": 0, "email": 0}

    for item in candidates:
        urgency = str(item.get("urgency") or "").strip().lower()

        # --- Rule 1: eligibility by urgency ---
        if urgency not in _ELIGIBLE_URGENCIES:
            skipped.append({
                "reason": f"urgency='{urgency}' not eligible in v1 (only alta/media)",
                "item": item,
            })
            continue

        channel = _CHANNEL_FOR_URGENCY[urgency]

        # --- Rule 3: intra-run dedup ---
        summary = str(item.get("summary") or item.get("title") or "").strip()
        dedup_key = f"{summary}|{channel}"
        if dedup_key in seen_dedup:
            skipped.append({
                "reason": f"duplicate summary+channel ('{channel}') skipped",
                "item": item,
            })
            continue

        # --- Rule 2: channel cap ---
        cap = _CHANNEL_CAPS.get(channel, 0)
        if channel_counts[channel] >= cap:
            skipped.append({
                "reason": f"channel cap reached: {channel} limit={cap}",
                "item": item,
            })
            continue

        # --- Accept ---
        seen_dedup.add(dedup_key)
        channel_counts[channel] += 1
        selected_by_channel[channel].append(item)

    return {
        "selected_by_channel": selected_by_channel,
        "skipped": skipped,
    }
