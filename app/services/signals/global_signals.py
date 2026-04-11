"""
services/signals/global_signals.py
------------------------------------
Global signal identity and lifecycle management for SmartCounter.

Provides:
  - build_global_signal_id: stable cross-ingestion identity derived purely
    from semantic content (signal_code + entity_ref + source_module).
  - compute_signal_lifecycle: classifies signals as open, persisting, or
    resolved by diffing a previous against a current signals snapshot.

Guarantees:
  - Deterministic: same input → identical output.
  - No mutations: input lists are never modified.
  - No side effects: no I/O, logging, timestamps, or shared state.
"""

import hashlib
import json
from typing import Any

Signal = dict[str, Any]

# Keys used to derive the global signal identity.
# Intentionally excludes: ingestion_id, severity, context, priority_score,
# created_at — all of which are volatile or ingestion-specific.
_IDENTITY_KEYS: tuple[str, ...] = ("signal_code", "entity_ref", "source_module")

# Valid lifecycle status values.
STATUS_OPEN: str = "open"
STATUS_PERSISTING: str = "persisting"
STATUS_RESOLVED: str = "resolved"


# ---------------------------------------------------------------------------
# Part 1 — Global Signal ID
# ---------------------------------------------------------------------------

def build_global_signal_id(signal: Signal) -> str:
    """
    Build a stable, cross-ingestion global signal identifier.

    Identity is derived exclusively from:
        - signal_code   (what kind of issue)
        - entity_ref    (which entity is affected)
        - source_module (which module produced the signal)

    Intentionally excluded from hashing:
        - ingestion_id  (changes every run)
        - severity      (may be upgraded/downgraded)
        - context       (may evolve)
        - priority_score, created_at, status

    This ensures the same real-world problem maps to the same ID across
    multiple ingestion cycles, enabling deduplication and lifecycle tracking.

    Returns:
        "gsi_<hex24>" — a 28-character string.

    Raises:
        KeyError if any identity key is absent from the signal dict.
        ValueError if any identity value is not a non-empty string.
    """
    for key in _IDENTITY_KEYS:
        value = signal.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(
                f"build_global_signal_id: field '{key}' must be a "
                f"non-empty string, got {value!r}."
            )

    canonical_obj: dict[str, str] = {
        "entity_ref": signal["entity_ref"].strip(),
        "signal_code": signal["signal_code"].strip(),
        "source_module": signal["source_module"].strip(),
    }
    canonical = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"gsi_{digest[:24]}"


# ---------------------------------------------------------------------------
# Part 2 — Lifecycle Engine
# ---------------------------------------------------------------------------

def _enrich_with_global_id(signal: Signal) -> Signal:
    """
    Return a new signal dict with 'global_signal_id' added.
    The original dict is never mutated.
    """
    return {**signal, "global_signal_id": build_global_signal_id(signal)}


def _build_index(signals: list[Signal], id_key: str) -> dict[str, Signal]:
    """
    Index a list of signals by the value of id_key.
    Raises ValueError on duplicate keys (signals must already be deduplicated).
    """
    index: dict[str, Signal] = {}
    for signal in signals:
        key = signal.get(id_key)
        if key is None:
            raise ValueError(
                f"Signal is missing index key '{id_key}': {signal!r}"
            )
        if key in index:
            raise ValueError(
                f"Duplicate '{id_key}' detected: '{key}'. "
                "Input signals must be deduplicated before lifecycle computation."
            )
        index[key] = signal
    return index


def compute_signal_lifecycle(
    previous_signals: list[Signal],
    current_signals: list[Signal],
) -> dict[str, Any]:
    """
    Classify signals into lifecycle states by diffing two snapshots.

    Args:
        previous_signals:
            Signals from the prior ingestion cycle. Each must already carry
            a 'global_signal_id' field (i.e. produced by a prior call to
            this function or enriched externally).

        current_signals:
            Normalized signals from the current ingestion cycle. They do NOT
            need to carry 'global_signal_id' yet — it is computed here.

    Steps:
        1. Enrich every current signal with its global_signal_id.
        2. Index both lists by global_signal_id.
        3. Classify:
              open       — in current, not in previous  → status: "open"
              persisting — in both current and previous  → status: "persisting"
              resolved   — in previous, not in current   → status: "resolved"
        4. Return structured output (no mutation of inputs).

    Edge cases:
        - previous_signals empty → all current are "open".
        - current_signals empty  → all previous are "resolved".
        - duplicates in either list → raises ValueError.

    Returns:
        {
            "current": [
                {
                    ...original fields...,
                    "global_signal_id": "gsi_...",
                    "status": "open" | "persisting",
                }
            ],
            "lifecycle": {
                "open":       [enriched signals with status="open"],
                "persisting": [enriched signals with status="persisting"],
                "resolved":   [previous signals with status="resolved"],
            },
        }
    """
    # Step 1 — Enrich current signals with global IDs (no mutation).
    enriched_current: list[Signal] = [
        _enrich_with_global_id(s) for s in current_signals
    ]

    # Step 2 — Build indexes.
    prev_index: dict[str, Signal] = _build_index(
        previous_signals, "global_signal_id"
    )
    curr_index: dict[str, Signal] = _build_index(
        enriched_current, "global_signal_id"
    )

    # Step 3 — Classify.
    open_signals: list[Signal] = []
    persisting_signals: list[Signal] = []

    for gsi, signal in curr_index.items():
        if gsi in prev_index:
            persisting_signals.append({**signal, "status": STATUS_PERSISTING})
        else:
            open_signals.append({**signal, "status": STATUS_OPEN})

    resolved_signals: list[Signal] = [
        {**signal, "status": STATUS_RESOLVED}
        for gsi, signal in prev_index.items()
        if gsi not in curr_index
    ]

    # Step 4 — Build annotated current list preserving deterministic order.
    annotated_current: list[Signal] = [
        {
            **signal,
            "status": (
                STATUS_PERSISTING
                if signal["global_signal_id"] in prev_index
                else STATUS_OPEN
            ),
        }
        for signal in enriched_current
    ]

    return {
        "current": annotated_current,
        "lifecycle": {
            "open": open_signals,
            "persisting": persisting_signals,
            "resolved": resolved_signals,
        },
    }
