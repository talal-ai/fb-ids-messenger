# Contracts

Phase 1 contract package for cross-boundary communication between:
- `engine/`
- `control-plane/`
- `operator-app/`

## Versioning policy

- Contract versions are explicit in filenames (`*.v1.json`).
- Any new required field requires a major version bump (`v2`).
- Additive optional fields can be minor updates without changing major version.
- Breaking enum/state changes require a major version bump.

## Canonical payloads in v1

- `schemas/inbound-event.v1.json`
- `schemas/reply-command.v1.json`
- `schemas/reply-attempt.v1.json`
- `schemas/common-types.json`

## Non-negotiable semantics

- `message_raw` is immutable and must be sent literally.
- `idempotency_key` is mandatory on reply commands.
- Route identity requires `account_id` + `conversation_id` + `event_id`.

## Fixtures

Fixtures live in `contracts/fixtures/` and include:
- valid and invalid payload samples
- hash vectors for literal-send checks

