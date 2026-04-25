# Phase 2 Control Plane (Implementation)

This document describes the localhost HTTP control-plane surface added in Phase 2: validated JSON ingress for inbound events and reply commands, SQLite persistence extensions, idempotency, and the reply attempt ledger.

## Feature flag and rollback

- **Default**: HTTP API is **off**. Telegram and the existing reply queue behave as before.
- **Enable**: Set `control_plane_http_enabled` to `true` in the Electron store **and** set a non-empty `control_plane_token`, **or** set environment variables `CONTROL_PLANE_HTTP=true` and `CONTROL_PLANE_TOKEN=<secret>` when launching the app.
- **Optional**: `control_plane_http_port` (store) or `CONTROL_PLANE_HTTP_PORT` (default `3847`).
- **Rollback**: Clear the flag / env and restart the app; no schema downgrade is required.

## Authentication

All `/v1/*` routes require:

`Authorization: Bearer <control_plane_token>`

`GET /health` does not require a token (returns `{ ok: true, service: "control-plane" }`).

## Routes

| Method | Path | Body | Success | Failure |
|--------|------|------|---------|---------|
| GET | `/health` | — | 200 | — |
| POST | `/v1/inbound-events` | `InboundEvent` v1 JSON | 200 `{ ok: true, inbound_event_id, duplicate? }` | 400 `validation_error` |
| POST | `/v1/reply-commands` | `ReplyCommand` v1 JSON | 200 `{ ok: true, reply_id, reply_job_id, ... }` | 400 or 409 `idempotency_conflict` |

Payloads must conform to [`contracts/schemas/`](/contracts/schemas/). Rejections use stable `code` values aligned with [`PHASE1_INVARIANTS.md`](PHASE1_INVARIANTS.md).

## Persistence (SQLite)

Migrations live in [`desktop/db/migrations-phase2.js`](../../desktop/db/migrations-phase2.js) and are applied from [`desktop/db/database.js`](../../desktop/db/database.js) after `schema.sql`.

- **`inbound_events`**: `event_id` (string), `event_hash` (SHA-256 hex of canonical fields).
- **`reply_jobs`**: `reply_id`, `idempotency_key` (unique when set), `event_id`, `message_hash`, `expected_conversation_version`, `error_code`.
- **`reply_attempts`**: append-only execution history per job (maps to `ReplyAttempt` v1 semantics).

## Engine wiring

- [`desktop/services/message-monitor.js`](../../desktop/services/message-monitor.js) writes `event_id` / `event_hash` on new inbound rows using [`control-plane/lib/hashes.js`](../../control-plane/lib/hashes.js).
- [`desktop/services/reply-service.js`](../../desktop/services/reply-service.js) computes `message_hash` for all queued replies, records `reply_attempts`, and verifies literal-send hash before typing; terminal hash mismatch uses `literal_hash_mismatch` / `dead_letter` per invariants.

## Tests

- `npm test` runs Jest against [`control-plane/**/*.test.js`](../../control-plane/).
- Contract validation uses Ajv JSON Schema 2020-12 with [`ajv-formats`](https://github.com/ajv-validator/ajv-formats).
