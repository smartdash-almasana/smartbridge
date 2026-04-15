# ARCHITECTURE_STATE.md

## 1. SYSTEM OVERVIEW

SmartBridge is a modular backend system designed to unify:

* SmartSeller (event reality, e.g. MercadoLibre data)
* SmartCounter (analysis, reconciliation, accounting intelligence)

Purpose:

* Ingest heterogeneous business data (emails, Excel, APIs)
* Normalize and reconcile information
* Detect inconsistencies (findings)
* Transform them into actionable signals
* Drive decisions via Action Engine and Digest

---

## 2. CURRENT MODULES (REAL STATE)

### Core Modules

* **entity_resolution**

  * Status: DONE
  * Type: deterministic (email + alias)
  * Responsibility: map input -> entity_id

* **findings_engine**

  * Status: DONE
  * Type: deterministic
  * Responsibility: rows -> findings

* **normalized_signals**

  * Status: CORE (CANONICAL)
  * Responsibility: findings -> normalized signals

* **global_signals**

  * Status: ACTIVE
  * Responsibility: lifecycle (open / persisting / resolved)

* **action_engine**

  * Status: ACTIVE
  * Responsibility: signals -> action jobs

---

### Supporting Modules

* **reconciliation/**

  * Contains domain-specific logic (matching, diff, etc.)
  * Includes legacy signal generation (NOT canonical)

* **ingestion_loader / ingestion_persistence**

  * Handle ingestion pipeline and storage

* **digest**

  * Builds summaries and outputs for user

* **telegram loop**

  * Handles human-in-the-loop interactions

---

## 3. SIGNALS ARCHITECTURE (CRITICAL)

### Canonical Layer

```text
normalized_signals = SINGLE SOURCE OF TRUTH
```

### Forbidden

* Creating new signal engines
* Duplicating mapping logic
* Generating signals outside normalized_signals

### Existing Duplication (TO BE CONSOLIDATED)

* reconciliation/signals.py
* signals_engine.py (root)
* action_engine internal mappings

These must be reduced or absorbed into normalized_signals.

---

## 4. DATA FLOW (LOCKED)

```text
INPUT
-> ingestion
-> entity_resolution
-> findings_engine
-> normalized_signals
-> global_signals (lifecycle)
-> action_engine
-> digest
-> OUTPUT
```

This flow MUST NOT be broken.

---

## 5. CONTRACTS

### Findings

```json
{
  "type": "string",
  "severity": "low | medium | high",
  "description": "string",
  "entity_id": "string | null",
  "metadata": {}
}
```

---

### Normalized Signals

```json
{
  "signals": [
    {
      "signal_id": "string",
      "signal_code": "string",
      "severity": "low | medium | high",
      "priority_score": number,
      "entity_ref": "string",
      "source_module": "string",
      "ingestion_id": "string",
      "created_at": "ISO_TIMESTAMP",
      "context": []
    }
  ],
  "summary": {
    "total_signals": number,
    "high_priority": number,
    "medium_priority": number,
    "low_priority": number
  }
}
```

---

## 6. NON-NEGOTIABLE RULES

* DO NOT create duplicate layers
* DO NOT redesign without reading this file
* ALWAYS extend existing modules
* normalized_signals is the ONLY signal generator
* entity_resolution must remain deterministic-first
* findings_engine must remain pure and deterministic

---

## 7. KNOWN ISSUES

* Multiple signal layers exist (fragmentation)
* signals_engine.py is still active in current runtime
* consolidation is still pending
* reconciliation/signals contains overlapping logic
* Contract mismatch:

  * entity_id (findings)
  * entity_ref (signals)

* Some business logic exists inside API routes (saas.py)

---

## 8. CURRENT PRIORITY

```text
CONSOLIDATE SIGNALS LAYER
```

Steps:

1. Move all mapping logic -> normalized_signals
2. Remove duplicated signal generation
3. Ensure findings -> normalized_signals is the ONLY path
4. Keep lifecycle (global_signals) unchanged

---

## 9. DEVELOPMENT METHOD (MANDATORY)

For every change:

1. Read this file
2. Identify affected module
3. Apply minimal patch (no rewrite)
4. Validate with deterministic tests

---

## 10. NEXT STEPS

* Consolidate signals
* Clean mapping registry
* Stabilize orchestrator
* THEN introduce AI layer (optional, controlled)
* THEN full QA

---

## 11. CORE PRINCIPLE

```text
SYSTEM MEMORY MUST LIVE IN THE REPOSITORY, NOT IN THE CHAT
```
