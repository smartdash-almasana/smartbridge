# SmartBridge Repository Structure

## Canonical Layout

```text
smartbridge/
  app/
    api/
      routes/
    services/
      signals/
      digest/
      telegram/
      action_engine/
      reconciliation/
      normalized_signals/
      ingestion/
    core/
    domain/
    adapters/
    main.py
  tests/
    services/
      digest/
      signals/
      telegram/
      reconciliation/
      normalized_signals/
  scripts/
  docs/
  README.md
  requirements.txt
```

## Responsibilities

- `app/main.py`: single FastAPI entrypoint.
- `app/api/routes`: HTTP routes.
- `app/services/signals`: signal lifecycle and persistence.
- `app/services/digest`: digest construction and grouped views.
- `app/services/telegram`: Telegram confirmation loop and idempotency.
- `tests/services/*`: tests mirrored by service domain.
- `scripts/`: operational helper scripts.
- `docs/`: architecture and operating docs.

## Entrypoint

Single backend entrypoint:

```bash
uvicorn app.main:app --reload
```

## How To Run

### Start API

```bash
uvicorn app.main:app --reload
```

### Run tests

```bash
pytest -q
```

or run deterministic minimal suites directly:

```bash
python tests/services/digest/test_digest_builder_minimal.py
python tests/services/digest/test_grouped_digest_minimal.py
python tests/services/telegram/test_telegram_loop_robustness_minimal.py
```

## Notes

- Structure cleanup performed without business-logic refactors.
- Telegram execution model, dispatcher, lifecycle and MCP integration remain unchanged.
