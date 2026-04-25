# Phase 1 Schema Mapping (Current -> Canonical)

## Purpose
Map existing SQLite/runtime fields to canonical Phase 1 contracts and identify migration gaps to be handled in Phase 2.

Source anchors:
- Current schema: `desktop/db/schema.sql`
- Current reply flow: `desktop/services/reply-service.js`

## InboundEvent mapping

| Canonical field | Current source | Notes |
|---|---|---|
| `event_id` | `inbound_events.id` (int) or future generated UUID | Gap: canonical expects stable string id. |
| `account_id` | `inbound_events.account_id` | Direct map. |
| `conversation_id` | `inbound_events.conversation_id` | Nullable today; canonical requires non-empty. |
| `sender_name` | `inbound_events.sender_name` | Direct map. |
| `body_raw` | `inbound_events.body` | Direct map. |
| `detected_at` | `inbound_events.created_at` | Epoch ms parity is already aligned. |
| `detector_source` | `inbound_events.detected_by` | Naming map only. |
| `event_hash` | `inbound_events.event_key` | Semantic match if event_key remains deterministic hash. |

Phase 2 migration items:
- P2-M1: Introduce explicit string `event_id` (UUID/ULID) while preserving integer PK.
- P2-M2: Enforce non-null conversation identity for operator-facing events.

## ReplyCommand mapping

| Canonical field | Current source | Notes |
|---|---|---|
| `reply_id` | `reply_jobs.id` (int) or generated string id | Gap: canonical string id needed. |
| `idempotency_key` | Not present | New required field. |
| `event_id` | Not present in `reply_jobs` | New required linkage. |
| `account_id` | `reply_jobs.account_id` | Direct map. |
| `conversation_id` | `reply_jobs.conversation_id` | Direct map. |
| `message_raw` | `reply_jobs.message_text` (dual-written from `reply_queue.message`) | Direct semantic map. |
| `expected_conversation_version` | Not present | New optional/nullable field. |
| `created_at` | `reply_jobs.created_at` | Direct map (epoch ms). |

Phase 2 migration items:
- P2-M3: Add `idempotency_key` column with uniqueness semantics.
- P2-M4: Add `event_id` linkage to inbound event identity.
- P2-M5: Add `expected_conversation_version`.

## ReplyAttempt mapping

Current state:
- Attempts are implicit via:
  - `reply_queue.attempts`
  - `reply_jobs.attempts`
  - status transitions in `reply-service.js`
- No first-class per-attempt table exists yet.

Canonical field mapping strategy:

| Canonical field | Current availability | Migration note |
|---|---|---|
| `attempt_id` | Not present | Create explicit attempt row id in Phase 2+. |
| `reply_id` | `reply_jobs.id` | Direct linkage once reply id normalized. |
| `worker_id` | Not present | Add worker identity in dispatcher. |
| `started_at` | `reply_jobs.execution_started_at` | Partial support exists. |
| `finished_at` | `reply_jobs.completed_at` | Partial support exists. |
| `status` | `reply_jobs.status` | Needs enum harmonization with canonical statuses. |
| `error_code` | `reply_jobs.last_error` (free text) | Split structured code vs detail in Phase 2+. |
| `error_detail` | `reply_jobs.last_error` | Preserve as human-readable detail. |
| `sent_hash` | Not present | Add with literal-send validation path. |

Phase 2 migration items:
- P2-M6: Add `reply_attempts` table.
- P2-M7: Introduce structured `error_code` + `error_detail`.
- P2-M8: Persist `sent_hash` on successful send.

## Legacy compatibility notes

- Current runtime uses dual-write (`reply_queue` + `reply_jobs`) in `reply-service.js`.
- Phase 1 does not remove dual-write behavior.
- Canonical contracts are locked now; persistence normalization is Phase 2+.

## Conflict register (must be resolved before control-plane cutover)

1. **ID shape mismatch**
   - Current integer PKs vs canonical string IDs.
2. **Missing idempotency key**
   - No dedicated dedup key on reply command today.
3. **No explicit attempt ledger**
   - Retries tracked as counters, not append-only attempts.
4. **No literal-send hash persistence**
   - Hash checks are policy-defined but not yet persisted end-to-end.

