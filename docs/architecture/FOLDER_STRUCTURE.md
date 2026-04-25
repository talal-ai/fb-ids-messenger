# Folder Structure (North-Star)

## Canonical Top-Level Layout
```text
repo-root/
├── engine/
├── control-plane/
├── operator-app/
├── contracts/
├── docs/
├── integrations/
├── infra/
└── .cursor/
```

## Ownership by Folder
- `engine/`
  - Owns FB sessions, Playwright contexts, inbound detection, and reply execution.
  - Must not depend on `operator-app/`.
- `control-plane/`
  - Owns APIs, queue processing, dedup/idempotency checks, and audit trail.
  - Is the integration boundary between engine and operator app.
- `operator-app/`
  - Owns inbox UX and reply submission UX.
  - Must not own FB credentials.
- `contracts/`
  - Owns shared schemas and optional generated types.
  - Only source of truth for payload shapes.
- `docs/`
  - Owns canonical architecture docs and runbooks.
  - `docs/archive/` tracks historical plan docs.
- `integrations/`
  - Optional external adapters (for example Telegram alert-only adapter).
- `infra/`
  - Deployment and environment files.

## Recommended Internal Layout
```text
engine/
├── desktop/
│   ├── main.js
│   ├── preload.js
│   ├── services/
│   └── db/
└── worker/

control-plane/
├── src/
│   ├── api/
│   ├── domain/
│   ├── persistence/
│   ├── queue/
│   ├── relay/
│   └── auth/
└── db/

operator-app/
└── src/
    ├── app/
    ├── features/
    ├── api-client/
    └── shared/

contracts/
└── schemas/
```

## Migration Note
This repository currently has `desktop/` and `src/` at root. Migration can be incremental:
1. Add new top-level folders first.
2. Introduce adapters/contracts.
3. Move modules only when callsites are stable and tested.

