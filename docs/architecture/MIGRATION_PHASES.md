# Migration Phases

## Goal
Transition from Telegram-centric operations to operator-app-centric operations without breaking current production behavior.

## Phase 0: Baseline and Documentation Convergence
- Freeze canonical direction in `docs/architecture/*`.
- Label historical docs in `docs/archive/README.md`.
- Define contract boundaries and naming standards.

Exit criteria:
- Canonical docs exist and are internally consistent.

## Phase 1: Control-Plane Surface Introduction
- Introduce initial control-plane API surface for inbound events and reply commands.
- Keep Telegram path fully operational.
- Ensure incoming reply requests carry deterministic routing fields.

Exit criteria:
- Both old and new interfaces can ingest events/commands.

## Phase 2: Dual-Run and Parity Measurement
- Mirror notifications to operator app while still using Telegram.
- Compare route correctness, latency, and failure behavior.
- Start collecting parity metrics and dead-letter diagnostics.

Exit criteria:
- Parity thresholds met for a defined observation window.

## Phase 3: Reply Authority Switch
- Switch primary reply source to operator app.
- Keep Telegram optional for alert-only fallback.
- Enforce literal send checks in primary path.

Exit criteria:
- Operator path stable under expected load; no elevated misroutes.

## Phase 4: Legacy Coupling Decommission
- Remove direct operational dependencies on Telegram command parsing.
- Retain optional adapter for non-critical notifications if needed.
- Simplify pipeline assumptions and remove duplicate branches.

Exit criteria:
- Legacy path is no longer required for core operations.

## Global Rollback Strategy
- Every phase must define:
  - feature flag boundary
  - data compatibility fallback
  - operational switchback runbook

