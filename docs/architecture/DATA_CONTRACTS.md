# Data Contracts (Direction-Level)

## Purpose
Provide a single contract vocabulary across engine, control-plane, and operator-app.

This file defines directional contracts and required semantics. Field names can evolve only through versioned changes.

## InboundEvent
Represents one normalized inbound message event detected by the session engine.

Required fields:
- `event_id` (string, immutable unique id)
- `account_id` (string)
- `conversation_id` (string)
- `sender_name` (string)
- `body_raw` (string)
- `detected_at` (ISO timestamp or epoch ms, choose one globally)
- `detector_source` (string enum, e.g. `sidebar`, `network`, `notification-api`)
- `event_hash` (string, deterministic dedup hash)

Semantics:
- Immutable after acceptance.
- Can be delivered at least once.
- Consumer dedup uses `event_id` and/or `event_hash`.

## ReplyCommand
Represents a user-intended reply from operator app to a specific conversation.

Required fields:
- `reply_id` (string, immutable unique id)
- `idempotency_key` (string, caller-generated unique request key)
- `event_id` (string, source event reference)
- `account_id` (string)
- `conversation_id` (string)
- `message_raw` (string, literal operator text)
- `expected_conversation_version` (number or nullable)
- `created_at` (timestamp)

Semantics:
- `message_raw` must be sent literally.
- `idempotency_key` must be unique for effective dedup.
- If optimistic concurrency is enabled, reject stale `expected_conversation_version`.

## ReplyAttempt
Represents one execution attempt for a reply command.

Required fields:
- `attempt_id` (string)
- `reply_id` (string)
- `worker_id` (string)
- `started_at` (timestamp)
- `finished_at` (timestamp or null while running)
- `status` (enum: `queued`, `claimed`, `sending`, `sent`, `failed_retryable`, `dead_letter`, `cancelled`)
- `error_code` (string or null)
- `error_detail` (string or null)
- `sent_hash` (string or null)

Semantics:
- All state transitions are append-auditable.
- Retried attempts must not create duplicate business effects.

## Contract Quality Gates
- Backward compatibility for consumers is explicit and versioned.
- New required fields require contract version bump.
- No implicit transformation of `message_raw`.
- All contracts must be serializable without lossy conversion.

