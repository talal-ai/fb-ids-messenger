# Implementation Plan: Headless Multi-Account Facebook Messenger Relay

## Current State vs. Target State

### What STAYS (already working, reusable)

| Component | File | Status |
|-----------|------|--------|
| Electron multi-account session isolation | `electron/main.js` (BrowserView + partition) | ✅ Keep, refactor |
| Stealth / anti-detection layer | `electron/services/stealth-service.js` | ✅ Keep as-is |
| Human-like typing simulator | `electron/services/humanizer-service.js` | ✅ Keep as-is |
| Persistent account storage | `electron/services/store-manager.js` | ✅ Keep, extend |
| Socket.io relay server skeleton | `server/index.js` | ✅ Keep, extend |
| Firebase push notification code | `server/firebase.js` | ✅ Keep, configure |
| Mobile app Socket.io + FCM setup | `multi-messenger/app/(tabs)/index.tsx` | ✅ Keep, redesign UI |
| Battery optimization wizard | `multi-messenger/components/BatteryWizard.tsx` | ✅ Keep as-is |
| Dashboard preload bridge | `electron/dashboard-preload.js` | ✅ Keep, extend |

### What MUST CHANGE (broken / wrong approach)

| Component | File | Problem |
|-----------|------|---------|
| Message detection (preload) | `electron/facebook-preload.js` | Watches open chat only; needs headless inbox-wide detection |
| Reply dispatch (main process) | `electron/main.js` → `dispatch-reply` handler | Types into whatever chat is open; needs URL-based conversation navigation |
| Message payload structure | `electron/main.js` → `new-message-detected` handler | Missing: senderName, conversationId, senderAvatar |
| Server relay payload | `server/index.js` → `new-fb-message` handler | Passes incomplete data; needs structured message format |
| Mobile notification display | `multi-messenger/app/(tabs)/index.tsx` | Flat message list; needs per-conversation grouped inbox |
| Mobile reply targeting | `multi-messenger/app/(tabs)/index.tsx` → `sendMessage` | No conversationId; reply can't target correct thread |

### What's MISSING (not coded at all)

| Feature | Where it belongs |
|---------|-----------------|
| Notification API interception (primary detection) | New: `electron/facebook-preload.js` rewrite |
| Sidebar unread monitoring (secondary detection) | New: `electron/facebook-preload.js` rewrite |
| Conversation ID extraction | New: `electron/facebook-preload.js` rewrite |
| URL-based conversation navigation for replies | New: `electron/main.js` reply handler rewrite |
| Wait-for-textbox-ready logic before typing | New: `electron/facebook-preload.js` addition |
| Message deduplication | New: `electron/services/dedup-service.js` |
| Account health monitoring (session expired?) | New: `electron/services/health-monitor.js` |
| Desktop ↔ Server reconnection / retry logic | New: `electron/main.js` + `server/index.js` |
| Firebase serviceAccountKey.json | Config: `server/serviceAccountKey.json` |
| Structured notification payload with sender info | New: server + mobile changes |
| Mobile per-conversation reply screen | New: mobile app UI redesign |
| Reply confirmation (success/failure back to mobile) | New: full pipeline addition |

---

## Implementation Phases

### Phase 1: Headless Message Detection (Desktop Preload Rewrite)

**Goal**: Detect ALL new messages across ALL conversations without any chat being open.

**File**: `electron/facebook-preload.js` — full rewrite

**Strategy: Dual-Layer Detection**

**Layer A — Notification API Interception (primary)**
- Override the browser `Notification` constructor before Facebook loads
- When Facebook fires a notification (new message), intercept it
- Extract: sender name, message preview text, notification icon
- This works regardless of which chat is open or if inbox is focused
- Facebook fires these natively for all new messages

```
Intercept flow:
  Facebook calls → new Notification(title, { body, icon })
  Our override captures → { senderName: title, preview: body }
  Forward via IPC → main process
```

**Layer B — Sidebar Inbox Monitoring (secondary / enrichment)**
- MutationObserver on the conversation list sidebar (left panel)
- Detect: new unread indicators (bold names, blue dots, message count badges)
- Extract: sender name, last message text, conversation thread link (`/messages/t/{threadId}`)
- This provides the `conversationId` that Layer A cannot give alone
- Also acts as fallback if Facebook suppresses Notification API

**Layer C — Deduplication**
- Maintain a `Set` of recently-seen message hashes (sender + first 50 chars + timestamp rounded to 5s)
- Prevent the same message from being forwarded multiple times
- Auto-expire hashes after 60 seconds to keep memory bounded

**New structured payload sent via IPC**:
```javascript
{
  senderName: "John Smith",
  messagePreview: "Is this still available?",
  conversationId: "t/1234567890",   // Thread ID for reply routing
  timestamp: 1707500000000,
  messageHash: "abc123"             // For dedup
}
```

**What is NOT changed**: The page still loads `facebook.com/messages/t/` — this keeps the sidebar visible for Layer B. No chat needs to be opened or focused.

---

### Phase 2: Reply System (Desktop — Invisible Programmatic Write)

**Goal**: When mobile sends a reply, send it through the correct Facebook conversation.

**File**: `electron/main.js` — rewrite `dispatch-reply` handler

**Important Clarification — "Does not open chats"**:
The user's requirement says the desktop does NOT open or switch chats. This means:
- The desktop UI never shows a Facebook chat to the human operator
- No BrowserView is ever attached to the main window for viewing
- The user never interacts with Facebook conversations on desktop

However, to SEND a reply, the BrowserView must programmatically load the
correct conversation URL so the preload script can type into the textbox.
This is an **invisible background operation** — the BrowserView is never
shown on screen. It is equivalent to an API call, not a UI action.

**Current (broken)**:
```
Mobile sends reply → main process → type into whatever is open
```

**New flow**:
```
Mobile sends reply with { accountId, conversationId, message }
  → main process finds BrowserView for accountId
  → saves current URL (always inbox: /messages/t/)
  → navigates view to: facebook.com/messages/t/{conversationId} (INVISIBLE — view is never shown)
  → waits for page load (did-finish-load event)
  → sends IPC to preload: 'type-message'
  → preload waits for textbox to appear in DOM (polling/observer)
  → preload types message via humanizer
  → preload presses Enter
  → preload confirms message sent (success)
  → main process navigates view BACK to inbox (/messages/t/) to resume detection
  → main process sends confirmation back to server → mobile
```

**Detection continuity during replies**:
- Layer A (Notification API interception) keeps working on ANY page — not affected by navigation
- Layer B (sidebar monitoring) is temporarily paused during the ~5-10s reply window
- After reply completes, view returns to inbox and Layer B resumes
- For high-volume accounts, replies are queued with minimum 3s spacing to avoid constant navigation

**New file**: `electron/services/reply-service.js`
- Encapsulates: navigate → wait → type → confirm → navigate back
- Handles timeouts (what if page doesn't load in 15s?)
- Handles textbox-not-found (what if Facebook layout changed?)
- Returns success/failure status
- Queues multiple replies per account to avoid navigation thrashing

**Key change in preload** (`facebook-preload.js`):
- New IPC handler: `navigate-and-reply` or split into:
  - `wait-for-textbox` — polls DOM until `div[role="textbox"]` exists, resolves
  - `type-message` — existing, but now only called AFTER textbox confirmed ready

---

### Phase 3: Relay Server Enhancements

**Goal**: Structured payloads, reliable delivery, reply confirmation.

**File**: `server/index.js` — extend

**Changes**:

1. **Structured message format**
   - Accept richer payload from desktop:
     ```javascript
     {
       accountId: "account_3",
       senderName: "John Smith",
       messagePreview: "Is this still available?",
       conversationId: "t/1234567890",
       timestamp: 1707500000000
     }
     ```
   - Forward complete payload to mobile (Socket.io + FCM)

2. **FCM payload upgrade** (in `server/firebase.js`)
   - Include `senderName` and `conversationId` in push data
   - Use `notification` field (not just `data`) so Android shows rich notification even when app is killed
   - Notification title: `"Account 3 — John Smith"`
   - Notification body: `"Is this still available?"`

3. **Reply routing with conversationId**
   - Mobile sends: `{ accountId, conversationId, message }`
   - Server forwards to desktop hub with all three fields
   - Desktop uses `conversationId` to navigate (Phase 2)

4. **Reply confirmation event**
   - New event: `reply-status` (desktop → server → mobile)
   - Payload: `{ accountId, conversationId, status: 'sent' | 'failed', reason? }`
   - Mobile shows checkmark or error on the reply

5. **Connection health**
   - Ping/pong heartbeat between desktop ↔ server
   - If desktop agent disconnects, notify mobile: "Desktop agent offline"
   - Auto-reconnect logic on desktop side with exponential backoff

---

### Phase 4: Mobile App Redesign

**Goal**: Notification-first inbox grouped by conversation, with quick-reply.

**File**: `multi-messenger/app/(tabs)/index.tsx` — major redesign

**Current UI**: Flat chronological message list (like a single chat room). No conversation separation, no sender identification, no conversation context.

**New UI Structure**:

```
┌─────────────────────────────────┐
│  FB Remote Hub    [Connected ●] │
├─────────────────────────────────┤
│                                 │
│  ┌─ Account: fb_marketplace_1 ──┐
│  │ John Smith                   │
│  │ "Is this still available?"   │
│  │ 2 min ago              [→]   │
│  └──────────────────────────────┘
│                                 │
│  ┌─ Account: fb_marketplace_2 ──┐
│  │ Sarah Connor                 │
│  │ "What's the lowest price?"   │
│  │ 5 min ago              [→]   │
│  └──────────────────────────────┘
│                                 │
│  ┌─ Account: fb_marketplace_1 ──┐
│  │ Mike Johnson                 │
│  │ "Can you deliver today?"     │
│  │ 12 min ago             [→]   │
│  └──────────────────────────────┘
│                                 │
└─────────────────────────────────┘
```

**Tap on a card → Quick Reply Screen**:
```
┌─────────────────────────────────┐
│  ← Back    John Smith           │
│           via fb_marketplace_1  │
├─────────────────────────────────┤
│                                 │
│  "Is this still available?"     │
│                                 │
├─────────────────────────────────┤
│  [Type reply...         ] [Send]│
│                                 │
│  Quick Replies:                 │
│  [Yes, still available!]        │
│  [Sorry, it's sold]            │
│  [Can you do $X?]              │
└─────────────────────────────────┘
```

**Key mobile features**:
- Conversation cards grouped by: account + sender + conversationId
- Each card shows: account label, sender name, message preview, time
- Tap to open minimal reply view (NOT full chat history — just the latest message + reply box)
- Quick-reply presets for common Marketplace responses
- Reply sends: `{ accountId, conversationId, message }`
- Reply confirmation: checkmark when desktop confirms sent

---

### Phase 5: Account Health & Session Monitoring

**Goal**: Know when a Facebook session expires or gets challenged.

**New file**: `electron/services/health-monitor.js`

**What it monitors per account**:
- Is the page still on `facebook.com/messages`? Or did it redirect to login?
- Is the page showing a security checkpoint / "Confirm your identity" screen?
- Is the sidebar rendering conversations? (proves session is alive)
- Did a network request return 401/403?

**Detection method**:
- Periodic URL check: `view.webContents.getURL()` — if it's not `/messages/`, session may be dead
- DOM check via preload: does `[role="navigation"]` exist? (proves Messenger UI loaded)
- Add IPC channel: `session-health-check` → preload responds with status

**When unhealthy**:
- Mark account as `status: 'session-expired'` in store
- Notify mobile: "Account X needs re-login"
- Stop forwarding messages for that account (prevent noise)
- Desktop UI shows which accounts need attention

---

### Phase 6: Firebase Configuration & Push Reliability

**Goal**: Make push notifications actually work.

**Tasks**:
1. Create Firebase project (manual, one-time)
2. Generate `serviceAccountKey.json` → place in `server/`
3. Configure mobile app with `google-services.json` (Android) / `GoogleService-Info.plist` (iOS)
4. Update FCM payload to use both `notification` + `data` fields:
   - `notification`: shows system tray notification (works when app killed)
   - `data`: contains `conversationId`, `accountId` for routing when user taps
5. Handle notification tap → deep-link to the correct reply screen in mobile app

---

## File Change Map

**Desktop UI is KEPT as-is** — it's useful for login management, monitoring, and tracking.
The key principle: mobile detection/reply works independently, without requiring desktop interaction.

```
electron/
  main.js                    ← MODIFY: rewrite reply handler (add conversationId navigation),
                                        add health check integration. All existing UI features
                                        (switch-view, hide-view, Live Grid) STAY.
  facebook-preload.js        ← REWRITE: notification intercept + sidebar monitor + dedup
  dashboard-preload.js       ← EXTEND: add health status channels (existing APIs stay)
  services/
    stealth-service.js       ← NO CHANGE
    humanizer-service.js     ← NO CHANGE
    store-manager.js         ← EXTEND: add account status/metadata fields
    reply-service.js         ← NEW: navigate → wait → type → confirm → navigate back
    dedup-service.js         ← NEW: message hash deduplication
    health-monitor.js        ← NEW: session health checks

server/
  index.js                   ← MODIFY: structured payloads, reply confirmation, health events
  firebase.js                ← MODIFY: rich notification format
  serviceAccountKey.json     ← NEW (manual config, not code)

multi-messenger/
  app/(tabs)/index.tsx       ← REWRITE: notification inbox UI + reply screen
  constants/config.ts        ← NO CHANGE (user configures IP)
  components/
    BatteryWizard.tsx         ← NO CHANGE
    ConversationCard.tsx     ← NEW: inbox card component
    QuickReplySheet.tsx      ← NEW: reply screen with presets

src/
  App.jsx                    ← EXTEND: add health status indicators (existing UI stays)
  components/
    Dashboard.jsx            ← EXTEND: show per-account health status
    ActiveAccounts.jsx       ← EXTEND: add health indicators per account (Live Grid stays)
    MobileRelay.jsx          ← NO CHANGE
```

---

## Implementation Order

```
Phase 1 (Critical) ─── Headless Message Detection ✅ COMPLETE
  └─ facebook-preload.js rewrite (dual-layer: Notification API + sidebar)
  └─ dedup-service.js (hash-based, 60s TTL)
  └─ main.js structured payload forwarding

Phase 2 (Critical) ─── Reply System ✅ COMPLETE
  └─ reply-service.js (navigate → wait → type → confirm → navigate back)
  └─ main.js dispatch-reply with conversationId routing
  └─ Per-account reply queue with 3s minimum gap

Phase 3 (Critical) ─── Server Payload Upgrade ✅ COMPLETE
  └─ server/index.js structured events + reply-status forwarding
  └─ server/firebase.js rich notifications (notification + data fields)

Phase 4 (Critical) ─── Mobile App Redesign ✅ COMPLETE
  └─ ConversationCard.tsx — inbox notification card
  └─ QuickReplySheet.tsx — reply screen with presets
  └─ index.tsx — inbox UI + FCM handler + reply-status confirmation

Phase 5 (Important) ── Health Monitoring ✅ COMPLETE
  └─ health-monitor.js (30s periodic checks, URL + IPC ping)
  └─ dashboard-preload.js + ActiveAccounts.jsx health indicators
  └─ Preload health-check updated with dynamic reply channel
  └─ health-monitor.js
  └─ Desktop + mobile health indicators
  └─ Test: expired session detected and reported to mobile

Phase 6 (Required) ─── Firebase Setup → MANUAL (see FIREBASE_SETUP.md)
  └─ serviceAccountKey.json (from Firebase Console)
  └─ google-services.json / GoogleService-Info.plist (mobile build)
  └─ Development build via EAS or prebuild
```

---

## Risk Factors

| Risk | Severity | Mitigation |
|------|----------|------------|
| Facebook changes Notification API behavior | High | Layer B (sidebar monitoring) as fallback |
| Facebook blocks Notification override in Electron | Medium | Fall back to sidebar-only detection |
| Facebook DOM structure changes break sidebar selectors | Medium | Use multiple selector strategies, ARIA-first |
| Session expiry during business hours | High | Health monitor + mobile alerts (Phase 5) |
| FCM token rotation breaks push delivery | Low | Re-register on every app open (already coded) |
| Rate limiting on rapid navigation for replies | Medium | Queue replies per account, minimum 3s gap |
| Humanizer typing too slow for high-volume replies | Low | Reduce delay range for Marketplace-style short replies |
