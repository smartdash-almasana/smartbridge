"""
constants.py
------------
Central configuration for the SmartBridge reconciliation module.
All domain constants live here. Import from this module only — do NOT
redeclare these values elsewhere.
"""

from typing import Final

# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

VALID_STATUSES: Final[frozenset] = frozenset({"paid", "pending", "cancelled"})

# Maps raw / alternative status strings to canonical form.
# Keys MUST be lowercase. Values MUST be members of VALID_STATUSES.
STATUS_NORMALIZATION_MAP: Final[dict[str, str]] = {
    # paid
    "paid": "paid",
    "pagado": "paid",
    "success": "paid",
    "completed": "paid",
    # pending
    "pending": "pending",
    "pendiente": "pending",
    "processing": "pending",
    # cancelled
    "cancelled": "cancelled",
    "cancelado": "cancelled",
    "failed": "cancelled",
    "error": "cancelled",
}

# ---------------------------------------------------------------------------
# Severity levels
# ---------------------------------------------------------------------------

SEVERITY_HIGH: Final[str] = "high"
SEVERITY_MEDIUM: Final[str] = "medium"
SEVERITY_LOW: Final[str] = "low"

# Ordered from most to least critical (used for deterministic sorting).
SEVERITY_ORDER: Final[dict[str, int]] = {
    SEVERITY_HIGH: 0,
    SEVERITY_MEDIUM: 1,
    SEVERITY_LOW: 2,
}

# ---------------------------------------------------------------------------
# Signal types
# ---------------------------------------------------------------------------

SIGNAL_ORDER_MISMATCH: Final[str] = "order_mismatch"
SIGNAL_MISSING_IN_EVENTS: Final[str] = "order_missing_in_events"
SIGNAL_MISSING_IN_DOCUMENTS: Final[str] = "order_missing_in_documents"

# ---------------------------------------------------------------------------
# Action types
# ---------------------------------------------------------------------------

ACTION_CREATE_EVENTS: Final[str] = "CREATE_EVENTS"
ACTION_CREATE_DOCUMENTS: Final[str] = "CREATE_DOCUMENTS"
ACTION_REVIEW_MISMATCHES: Final[str] = "REVIEW_MISMATCHES"

# Priority order for deterministic action list sorting (lower = higher priority).
ACTION_PRIORITY: Final[dict[str, int]] = {
    ACTION_REVIEW_MISMATCHES: 0,
    ACTION_CREATE_EVENTS: 1,
    ACTION_CREATE_DOCUMENTS: 2,
}

# ---------------------------------------------------------------------------
# Module metadata
# ---------------------------------------------------------------------------

MODULE_ID: Final[str] = "order_reconciliation"
SOURCE_TYPE: Final[str] = "dual_input"

# ---------------------------------------------------------------------------
# Health score
# ---------------------------------------------------------------------------

HEALTH_SCORE_MAX: Final[int] = 100
# Penalty applied per signal when computing health_score.
HEALTH_SCORE_PENALTY_PER_SIGNAL: Final[int] = 10
