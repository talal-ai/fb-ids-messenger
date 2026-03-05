# Multi-Messenger: Full Implementation Plan
## 1. Problem Statement
Build a Windows desktop app that manages messages across multiple personal Facebook accounts simultaneously. Must provide real-time notifications, instant reply from desktop and mobile (via Telegram), and persistent "set-and-forget" sessions.
## 2. Architecture
```warp-runnable-command
┌──────────────────────────────────────────────────────┐
│                 ELECTRON APP                         │
│  ┌────────────────────────────────────────────────┐  │
│  │ Renderer Process (React + TailwindCSS)         │  │
│  │  - Dashboard / Inbox / Conversation / Settings │  │
│  └──────────────────┬─────────────────────────────┘  │
│                     │ IPC (contextBridge)             │
│  ┌──────────────────▼─────────────────────────────┐  │
│  │ Main Process (Node.js + TypeScript)            │  │
│  │  ┌──────────────┐ ┌────────────────────────┐   │  │
│  │  │ Account Mgr  │ │ Message Detector       │   │  │
│  │  │ (Playwright) │ │ (WS frame intercept)   │   │  │
│  │  └──────┬───────┘ └────────────┬───────────┘   │  │
│  │         │                      │               │  │
│  │  ┌──────▼───────┐ ┌────────────▼───────────┐   │  │
│  │  │ Reply Sender │ │ Notification Service   │   │  │
│  │  │ (DOM typing) │ │ (Electron + Telegram)  │   │  │
│  │  └──────────────┘ └────────────────────────┘   │  │
│  │  ┌──────────────┐ ┌────────────────────────┐   │  │
│  │  │ Session      │ │ SQLite DB              │   │  │
│  │  │ Health Mon.  │ │ (better-sqlite3)       │   │  │
│  │  └──────────────┘ └────────────────────────┘   │  │
│  └────────────────────────────────────────────────┘  │
│         │                                            │
│  ┌──────▼────────────────────────────────────────┐   │
│  │ Hidden Chromium Instances (Playwright)         │   │
│  │  [Account1] [Account2] [Account3] [Account4]  │   │
│  │  Each on messenger.com with persistent session │   │
│  └───────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
          │
          ▼ (Telegram Bot API over HTTPS)
┌──────────────────────┐
│ User's Telegram App  │
│ (Phone/Tablet)       │
└──────────────────────┘
```
## 3. Tech Stack
* **Runtime:** Node.js 20+ (LTS)
* **Desktop Framework:** Electron 33+
* **UI:** React 18 + TailwindCSS 3 + Vite (bundler for renderer)
* **Browser Automation:** Playwright (chromium only)
* **Database:** SQLite via better-sqlite3
* **Telegram:** node-telegram-bot-api
* **Language:** TypeScript throughout
* **Packaging:** electron-builder (Windows NSIS installer)

```
## 5. Database Schema (001-initial.sql)
```SQL
CREATE TABLE accounts (
    id          TEXT PRIMARY KEY,          -- UUID
    nickname    TEXT NOT NULL,             -- User-given name ("Profile #3")
    fb_user_id  TEXT,                      -- Facebook user ID (extracted after login)
    fb_name     TEXT,                      -- Facebook display name
    profile_dir TEXT NOT NULL,             -- Path to Playwright user data dir
    proxy_url   TEXT,                      -- Optional proxy (socks5://...)
    status      TEXT DEFAULT 'offline',    -- 'active' | 'offline' | 'needs_login' | 'checkpoint'
    created_at  INTEGER NOT NULL,          -- Unix timestamp
    updated_at  INTEGER NOT NULL
);
CREATE TABLE conversations (
    id              TEXT PRIMARY KEY,      -- thread-id from Facebook
    account_id      TEXT NOT NULL,         -- FK to accounts.id
    participant_name TEXT,                 -- Name of the other person
    participant_fb_id TEXT,               -- Their Facebook ID
    participant_avatar_url TEXT,          -- Avatar URL (cached)
    last_message    TEXT,                 -- Preview text
    last_message_at INTEGER,             -- Unix timestamp
    unread_count    INTEGER DEFAULT 0,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE messages (
    id              TEXT PRIMARY KEY,      -- Message ID from Facebook
    conversation_id TEXT NOT NULL,         -- FK to conversations.id
    account_id      TEXT NOT NULL,         -- FK to accounts.id
    sender_fb_id    TEXT NOT NULL,         -- Who sent it
    sender_name     TEXT,
    body            TEXT,                  -- Message text
    timestamp       INTEGER NOT NULL,      -- Unix timestamp
    is_outgoing     INTEGER DEFAULT 0,     -- 1 if sent by us
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, timestamp);
CREATE INDEX idx_conversations_account ON conversations(account_id, last_message_at DESC);
```
## 6. IPC API Contract (src/shared/ipc-api.ts)
Channels exposed from main → renderer via contextBridge:
**Accounts:**
* `accounts:list` → returns `Account[]`
* `accounts:add` → opens Playwright login window, returns `Account` on success
* `accounts:remove(id)` → stops context, deletes profile dir
* `accounts:status-update` → event pushed from main when status changes
**Conversations:**
* `conversations:list(accountId?)` → returns `Conversation[]` (all accounts if no filter)
* `conversations:get(conversationId)` → returns `Conversation` with messages
* `conversations:mark-read(conversationId)` → resets unread count
**Messages:**
* `messages:list(conversationId, limit, offset)` → paginated messages
* `messages:send(conversationId, body)` → triggers reply-sender, returns success/fail
* `messages:new-message` → event pushed from main when a message arrives
**Settings:**
* `settings:get(key)` → returns value
* `settings:set(key, value)` → saves setting
* `settings:get-all` → returns all settings
**Telegram:**
* `telegram:configure(botToken)` → validates and stores bot token
* `telegram:test` → sends test message to user
* `telegram:status` → returns connected/disconnected
## 7. Implementation Phases
### Phase 1: Project Scaffold + Account Login (Week 1)
**Goal:** Working Electron app where you can add a Facebook account and see it in the dashboard.
**Tasks:**
1. Initialize project: `package.json`, TypeScript configs, Vite config, TailwindCSS
2. Electron main process entry (`src/main/index.ts`):
    * Create BrowserWindow pointing to Vite dev server (dev) or built HTML (prod)
    * System tray icon with show/quit options
3. Preload script with contextBridge exposing IPC API
4. React renderer with routing (react-router-dom):
    * Sidebar layout with navigation
    * DashboardPage placeholder
5. SQLite database setup (`src/main/db/database.ts`):
    * Run migrations on startup
    * Create initial schema
6. Account Manager (`src/main/services/account-manager.ts`):
    * `addAccount(nickname, proxyUrl?)`: creates UUID, profile dir, launches `chromium.launchPersistentContext()` with `headless: false` pointed at `messenger.com`
    * User logs in manually in the visible browser
    * App watches for URL to become `messenger.com/t/` (inbox) → marks login success
    * Saves account to SQLite, closes visible window
    * `launchAccount(id)`: relaunches context in `headless: true`
    * `removeAccount(id)`: closes context, deletes profile dir, removes from DB
    * `getStatus(id)`: checks if page is still on messenger.com
7. Stealth config (`src/main/services/stealth.ts`):
    * Init script that overrides `navigator.webdriver`
    * Realistic viewport, user-agent, locale settings
8. DashboardPage with AccountList showing added accounts + AddAccountModal
9. IPC handlers for `accounts:*` channels
**Deliverable:** App launches, you click "Add Account", a browser opens, you log into Facebook, the app remembers the session. On next launch, it reconnects automatically.
### Phase 2: Real-Time Message Detection + Notifications (Week 2)
**Goal:** App detects incoming messages in real-time and shows desktop notifications.
**Tasks:**
1. Message Detector (`src/main/services/message-detector.ts`):
    * For each active account's Playwright page, attach `page.on('websocket', ws => ...)`
    * Filter WebSockets connecting to `*edge-chat.messenger.com*`
    * Listen to `ws.on('framereceived', frame => ...)` for incoming MQTT data
    * Pass raw frame data to message-parser
2. Message Parser (`src/main/services/message-parser.ts`):
    * Decode MQTT frames (they arrive as binary or JSON)
    * Look for `/t_ms` topic payloads containing `deltas` array
    * Extract `deltaNewMessage` events: `body`, `messageMetadata.actorFbId`, `messageMetadata.threadKey.threadFbId`, `messageMetadata.timestamp`
    * Resolve sender name (may need to scrape from Messenger DOM or cache from previous interactions)
    * Emit parsed `IncomingMessage` events
3. Store incoming messages in SQLite:
    * Upsert conversation record
    * Insert message record
    * Increment unread_count
4. Desktop Notification (`src/main/services/notification.ts`):
    * On new message event → `new Notification({ title: accountNickname, body: "SenderName: message preview" })`
    * Click notification → focus window, navigate to that conversation
5. Push new-message events to renderer via IPC (`messages:new-message`)
6. Update DashboardPage to show unread counts per account
7. DOM polling fallback (`message-detector.ts`):
    * Every 30s, evaluate JS in the page to check for unread badges in the sidebar
    * If unread found that wasn't caught by WebSocket, trigger a manual check
**Deliverable:** All connected accounts receive real-time desktop notifications when a message arrives. Messages are stored in the local DB.
### Phase 3: Inbox + Conversation UI + Reply (Week 3)
**Goal:** Full messaging UI — see all conversations, read messages, send replies.
**Tasks:**
1. InboxPage (`src/renderer/pages/InboxPage.tsx`):
    * Fetch all conversations across accounts, sorted by last_message_at DESC
    * Each row: AccountBadge (colored dot + account name), sender avatar, sender name, message preview, timestamp
    * Filter by account (dropdown)
    * Click row → navigate to ConversationPage
2. ConversationPage (`src/renderer/pages/ConversationPage.tsx`):
    * Header: sender name, account badge, online status
    * MessageList: scrollable thread with sent/received bubble styling
    * Messages loaded from SQLite, newest at bottom
    * Auto-scroll to bottom on new messages
    * ReplyInput at bottom with send button
3. Reply Sender (`src/main/services/reply-sender.ts`):
    * `sendReply(accountId, conversationId, messageBody)`:
        1. Get the account's Playwright page
        2. Navigate to `https://www.messenger.com/t/<thread-id>` if not already there
        3. Wait for the message input (`page.waitForSelector('[role="textbox"]')`) 
        4. Click the input
        5. Type message with human-like delays (50-150ms between characters)
        6. Press Enter
        7. Wait briefly, verify message appeared in DOM
        8. Return success
    * After sending, store outgoing message in SQLite
4. IPC handlers for `messages:send`, `conversations:list`, `messages:list`
5. Real-time UI updates: when `messages:new-message` event fires, update inbox list and open conversation if applicable
6. Conversation history bootstrapping:
    * On first view of a conversation, scrape the visible messages from Messenger DOM
    * Store them in SQLite so they're available offline
**Deliverable:** Full chat experience. Click a notification → see the conversation → type a reply → it sends on Facebook.
### Phase 4: Telegram Mobile Relay (Week 4)
**Goal:** Get Facebook message notifications on your phone via Telegram and reply from there.
**Tasks:**
1. Telegram Relay (`src/main/services/telegram-relay.ts`):
    * Initialize `node-telegram-bot-api` with stored bot token
    * Use long-polling mode (no webhook server needed)
2. Setup flow:
    * User enters bot token in Settings
    * App validates token by calling `getMe()`
    * App waits for user to send `/start` to the bot
    * On `/start`, capture `msg.chat.id` and store in settings
3. Forward notifications:
    * On new FB message → format and send to Telegram:
```warp-runnable-command
📩 [Profile #3] New message
From: Client X
"Hey, are you available for a call?"

Reply: /r 3 your message here
```
4. Receive replies:
    * Listen for `/r <accountNumber> <message>` commands
    * Map account number to account ID
    * Determine the "last active conversation" for that account (most recent incoming message)
    * Call reply-sender to send the message
    * Confirm delivery back to Telegram: "✅ Sent on Profile #3"
5. Additional commands:
    * `/r <accountNumber>:<threadId> <message>` — reply to specific conversation
    * `/status` — list all accounts with status
    * `/accounts` — numbered list of accounts
    * `/mute <accountNumber>` / `/unmute <accountNumber>` — toggle Telegram notifications
    * `/help` — command reference
6. Settings UI (`SettingsPage.tsx`):
    * Telegram bot token input
    * Test connection button
    * Status indicator (connected/disconnected)
    * Notification toggle (which accounts forward to Telegram)
**Deliverable:** Receive all FB notifications on Telegram. Reply with `/r 3 message` and it sends from the correct account instantly.
### Phase 5: Session Resilience + Anti-Detection (Week 5)
**Goal:** App runs 24/7 without manual intervention. Sessions stay alive.
**Tasks:**
1. Session Health Monitor (`src/main/services/session-health.ts`):
    * Every 5 minutes, for each account:
     a. Check if Playwright context is still alive
     b. Check page URL — is it still on messenger.com?
     c. Check for checkpoint/login redirect pages
     d. Check WebSocket connection status (is MQTT still connected?)
* On failure, attempt auto-recovery:
     a. Refresh the page
     b. If still broken, close and relaunch context from persisted session
     c. If session fully expired, set status to 'needs_login' and notify user
* If checkpoint/CAPTCHA detected:
     a. Set status to 'checkpoint'
     b. Show notification: "Account X needs attention"
     c. Provide button to open visible browser for manual resolution
2. Enhanced stealth (`src/main/services/stealth.ts`):
    * Rotate user-agent strings (from a pool of real Chrome UAs)
    * Randomize canvas fingerprint via init script
    * Override WebGL vendor/renderer strings
    * Disable automation-related Chrome flags
    * Optional: per-account proxy support (SOCKS5/HTTP) via Playwright context `proxy` option
3. Human-like behavior (`src/main/utils/human-delay.ts`):
    * Random delays between 800ms-3s for navigation actions
    * Typing speed: 40-80ms per char with occasional pauses
    * Occasional mouse movements on the page to simulate activity
4. System tray improvements:
    * Minimize to tray instead of closing
    * Tray icon badge showing total unread count
    * Right-click menu: Show, Account Statuses, Quit
5. Auto-start on Windows boot:
    * Use `electron-builder` auto-launch or registry key
6. Logger (`src/main/utils/logger.ts`):
    * Rotating file logs in `data/logs/`
    * Log all important events: connections, disconnections, messages sent, errors
**Deliverable:** App runs reliably in background. Auto-recovers from disconnections. Minimizes to tray. Starts on boot.
### Phase 6: Polish + Packaging (Week 6)
**Goal:** Production-ready Windows installer.
**Tasks:**
1. Error handling sweep: try/catch around all Playwright operations, graceful failure
2. Offline handling: queue replies if account is temporarily disconnected, retry when back
3. Message search: basic text search across all messages in SQLite
4. Account reordering: drag-and-drop account order in dashboard
5. Dark/light theme toggle
6. electron-builder configuration:
    * NSIS installer for Windows
    * Bundle Playwright's Chromium binary
    * Code signing (optional but recommended)
    * Auto-update via electron-updater (optional)
7. Performance: lazy-load conversation history, virtualized message lists
8. Testing: basic integration tests for message-parser and reply-sender
**Deliverable:** Single `.exe` installer that sets up everything.
## 8. Key Dependencies (package.json)
* `electron`: ~33.x
* `electron-builder`: ~25.x
* `playwright`: ~1.50.x (install chromium only: `npx playwright install chromium`)
* `better-sqlite3`: ~11.x
* `node-telegram-bot-api`: ~0.66.x
* `react`: ~18.x
* `react-dom`: ~18.x
* `react-router-dom`: ~7.x
* `zustand`: ~5.x (lightweight state management)
* `tailwindcss`: ~3.x
* `vite`: ~6.x
* `@vitejs/plugin-react`: ~4.x
* `typescript`: ~5.x
* `uuid`: ~11.x
* `electron-log`: ~5.x (logging)
## 9. Critical Implementation Notes
**MQTT Frame Parsing:**
Facebook's MQTT-over-WebSocket frames can be binary (Thrift-encoded) or JSON. The web client uses JSON encoding. When intercepting via `ws.on('framereceived')`, the payload is a `Buffer`. Steps:
1. Skip MQTT control packets (PINGREQ/PINGRESP/CONNACK) — check first byte
2. For PUBLISH packets, extract the topic and payload
3. If topic is `/t_ms`, parse the JSON payload
4. Look for `deltas` array → filter for `class === "NewMessage"`
5. This is the most fragile part of the system — isolate it in `message-parser.ts` so when Facebook changes formats, you only update one file
**Sending Messages (DOM Approach):**
Messenger's input is a `contenteditable` div, not a regular `<input>`. Use:
```warp-runnable-command
await page.click('[role="textbox"]');
await page.keyboard.type(message, { delay: randomBetween(40, 80) });
await page.keyboard.press('Enter');
```
Do NOT use `page.fill()` — it doesn't trigger React's synthetic events properly on contenteditable elements.
**Session Persistence:**
Playwright's `launchPersistentContext(userDataDir)` stores cookies, localStorage, IndexedDB, and cache in the specified directory. As long as the user doesn't click "Log Out" on Facebook, the session survives app restarts indefinitely. Facebook sessions typically last 30-90 days before requiring re-auth.
**Proxy Configuration:**
Playwright supports per-context proxies:
```warp-runnable-command
chromium.launchPersistentContext(dir, {
  proxy: { server: 'socks5://proxy:1080', username: 'user', password: 'pass' }
})
```
This lets each account use a different IP, reducing ban risk significantly.