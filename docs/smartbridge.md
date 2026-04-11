# SmartBridge — System Documentation (Spec-Driven)

## Overview

SmartBridge is a deterministic operational intelligence system that reconciles events (SmartSeller) and documents (SmartCounter) to detect inconsistencies, prioritize issues, and trigger actions.

---

## Architecture

### Core Components

- SmartSeller (Events)
- SmartCounter (Documents)
- SmartBridge (Reconciliation + Decision + Action)

### Pipeline

events + documents
→ reconciliation
→ normalized_signals
→ global_signal_id
→ lifecycle
→ action_engine
→ dispatcher
→ persistence
→ digest

---

## Design Principles

- Deterministic (no randomness)
- Idempotent
- Audit-friendly
- Fail-fast validation
- Pure functions

---

## Data Contracts

### Signal

```json
{
  "signal_id": "string",
  "global_signal_id": "string",
  "signal_code": "string",
  "severity": "high|medium|low",
  "priority_score": 0-100,
  "entity_ref": "string",
  "source_module": "string",
  "ingestion_id": "string",
  "created_at": "ISO8601",
  "context": ["string"],
  "status": "open|persisting|resolved"
}
```

---

## Lifecycle

- open → new issue
- persisting → ongoing issue
- resolved → issue fixed

---

## Action Engine

Maps signals to actions:

- order_mismatch → review_order
- missing_invoice → request_document

---

## Dispatcher

Executes actions:

- input: pending actions
- output: completed actions with execution_result

---

## Persistence (SQLite)

Tables:

- ingestions
- signals_current
- signals_history
- actions
- action_history

---

## Spec-Driven Development

All modules follow strict contracts:

- input validation
- output validation
- invariant checks
- deterministic hashing

---

## Future Extensions

- OCR adapters
- Email ingestion
- AI insights layer
- Feedback learning loop

---

## Deployment

- Dockerized
- Runs on Google Cloud Run
- SQLite for initial state

---

## Summary

SmartBridge is not a dashboard. It is a system that:

- detects problems
- explains them
- triggers actions
- learns over time
