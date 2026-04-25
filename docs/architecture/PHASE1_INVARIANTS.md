# Phase 1 Invariants

## Purpose
Lock non-negotiable behavior constraints before control-plane or operator-app implementation.

These invariants define accept/reject logic and failure classes for contract-level behavior.

## 1) Routing invariants

### R1. Route identity is mandatory
A reply command is invalid unless all are present and non-empty:
- `account_id`
- `conversation_id`
- `event_id`

Enforcement:
- Reject at contract boundary.
- Classification: `validation_error`.

### R2. Cross-conversation send is terminal
If execution target does not match the command route identity, the attempt must fail and never auto-retry.

Enforcement:
- Mark `ReplyAttempt.status = dead_letter`.
- Classification: `routing_mismatch`.

## 2) Literal-send invariants

### L1. No transform path
`message_raw` must be treated as immutable payload in contract and dispatch boundaries.

Prohibited transformations:
- paraphrase
- autocomplete substitutions
- template interpolation
- whitespace normalization not explicitly requested by operator

### L2. Canonical hash definition
`message_hash = SHA-256(UTF-8 bytes of message_raw)`

Lock for v1:
- Encoding: UTF-8
- Newline normalization: none (preserve exact payload bytes)

### L3. Hash mismatch policy
If pre-send payload hash differs from accepted command hash:
- reject send
- do not press Enter / do not emit delivery success
- classify as terminal validation failure

Classification:
- `literal_hash_mismatch`

## 3) Idempotency invariants

### I1. Idempotency key required
Every `ReplyCommand` must include non-empty `idempotency_key`.

### I2. Duplicate same-intent commands deduplicate
Same `idempotency_key` + same route + same payload must not produce additional business effect.

Expected behavior:
- return existing command/result reference
- do not enqueue duplicate execution

### I3. Duplicate key with different payload is conflict
Same `idempotency_key` with changed route or changed `message_raw` is rejected.

Classification:
- `idempotency_conflict`

## 4) Ordering invariants

### O1. Scope ordering per route only
Ordering guarantees are scoped to `(account_id, conversation_id)`.

### O2. No global total ordering guarantee
System must not claim absolute ordering across all accounts or conversations.

## 5) Retry invariants

### T1. Retry only retryable classes
Retryable examples:
- temporary network failure
- transient engine context loss

Terminal examples:
- `routing_mismatch`
- `literal_hash_mismatch`
- `idempotency_conflict`

### T2. Bounded retries
Retries must be bounded and escalate to dead letter after max attempts.

## 6) Audit invariants

### A1. Every reply has attempt lineage
Each `ReplyCommand` must map to one or more `ReplyAttempt` records.

### A2. Terminal outcomes are explicit
Terminal state must include:
- `status`
- `error_code`
- timestamp fields

## 7) Invariant-to-status mapping

Recommended status usage:
- `queued`: accepted and waiting dispatch
- `claimed`: worker accepted dispatch ownership
- `sending`: execution in progress
- `sent`: success
- `failed_retryable`: temporary failure, retry scheduled
- `dead_letter`: terminal failure
- `cancelled`: explicitly cancelled before completion

