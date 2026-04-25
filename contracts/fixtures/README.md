# Contract Fixture Tests

These fixtures support schema-level verification in Phase 1.

## Files
- `inbound-event.valid.json`
- `inbound-event.invalid.missing-event-hash.json`
- `reply-command.valid.json`
- `reply-command.invalid.missing-idempotency-key.json`
- `reply-attempt.valid.json`
- `reply-attempt.invalid.status-not-allowed.json`
- `literal-send.hash-vectors.json`

## Intent
- Valid fixtures must pass their corresponding `*.v1.json` schema.
- Invalid fixtures must fail for the named reason.
- Hash vectors define canonical expected SHA-256 outputs for literal-send payloads.

