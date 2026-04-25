# Operator Onboarding (Draft)

## Purpose
Provide baseline onboarding for operators using the future operator app workflow.

## Core Concepts
- Inbox items map to deterministic identifiers.
- Replies are submitted as structured commands.
- Text is sent literally as typed.

## Operator Safety Rules
- Confirm target conversation identity before sending.
- Do not rely on free-form shortcuts for routing.
- If a reply shows validation mismatch, do not resend blindly; escalate.

## Escalation
- Dead-letter or repeated retry failures should follow the incident replay runbook.

