# Small-Plan Decision Checklist

Use this checklist before accepting any smaller implementation plan.

## Boundary and Scope
- Which boundary is changed: `engine`, `control-plane`, `operator-app`, `contracts`?
- What is explicitly out of scope?
- Which files/folders are affected?

## Reliability and Idempotency
- What is the idempotency key?
- Where is dedup enforced?
- What retry policy applies (attempt count, backoff, dead-letter behavior)?

## Routing and Accuracy
- How is deterministic routing guaranteed (`account_id`, `conversation_id`, `event_id`)?
- How is cross-conversation misroute prevented?
- What ordering constraints apply and where?

## Literal Send Integrity
- Does the plan preserve literal `message_raw` semantics?
- Is hash verification defined before send confirmation?
- Are all transform paths disabled for this flow?

## Observability and Audit
- What logs/metrics are added or reused?
- Can each `ReplyCommand` be traced to one or more `ReplyAttempt` rows?
- Are failure reasons actionable for operators?

## Compatibility and Rollback
- Which existing behavior is preserved?
- What is the feature flag or release switch?
- What is the rollback path if quality metrics regress?

## Verification
- What tests prove correctness?
- What smoke checks validate behavior in real runtime conditions?
- What measurable acceptance criteria define done?

