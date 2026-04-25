# Incident Replay and Dead-Letter (Draft)

## Purpose
Describe how to handle failed reply jobs and replay safely.

## Triage Steps
1. Identify failure class (`validation`, `routing`, `transient transport`, `session`).
2. Verify idempotency key and prior attempts.
3. Check whether literal-send validation failed.
4. Decide replay eligibility.

## Replay Rules
- Replay only when deterministic routing data is present.
- Preserve original `message_raw` and `idempotency_key` semantics.
- Record replay trigger and operator identity in audit trail.

## Do Not Replay When
- Route identity is ambiguous.
- Validation mismatch indicates text corruption risk.
- Upstream session/account is in unstable state.

