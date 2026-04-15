# CONTRACTS

Last audited: 2026-04-15

## API endpoints verificados
- `POST /api/v1/process`
- `GET /inbox?tenant_id=...`
- `GET /api/v1/clarifications`
- `POST /api/v1/clarifications/{clarification_id}/resolve`
- `POST /api/v1/jobs/{job_id}/rerun`

## Inbox snapshot
Document the top-level shape returned by `get_operational_inbox(tenant_id)`:
- `tenant_id`
- `counts`
- `pending_clarifications`
- `pending_actions`
- `recent_findings`
- `recent_messages`
- `priority_items`

## Priority items
State that `priority_items` mixes:
- `pending_action`
- `finding`
- `message`

And include priority values:
- `pending_action` = 100
- `finding` = 80 / 60 / 40
- `message` = 20

## Notification policy
Document:
- input: `priority_items`, `limit`
- only `alta` and `media` are eligible
- `alta` -> `telegram`
- `media` -> `email`
- channel caps:
  - telegram = 2
  - email = 3
- dedup key: `summary + channel`

## Delivery adapter
Document:
- channels: `telegram`, `email`
- statuses: `preview`, `sent`, `failed`

## Notification history
Document:
- source of truth: audit trail
- status map:
  - `delivery_preview_generated` -> `preview`
  - `delivery_sent` -> `sent`
  - `delivery_failed` -> `failed`
