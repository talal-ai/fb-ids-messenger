# Codebase Audit Report — Multi-FB Manager

Audit date: 2026-03-12. Focus: robustness, security, maintainability, and failure modes.

---

## 1. Critical / may break

### 1.1 Preload exposes generic `invoke` (security + stability)

**File:** `desktop/preload.js` (line 14)

```js
invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
```

**Issue:** The renderer can call any IPC channel by name. If the UI (or any injected script) calls `api.invoke('accounts:delete', 'acc_123')` or a non-existent channel, the main process will run it or reject. No whitelist.

**Risk:** XSS or bug could trigger destructive or unexpected handlers. Unregistered channels can throw and crash the renderer promise.

**Recommendation:** Remove generic `invoke`. Expose only explicit methods, e.g. `resetTelegramSettings: () => ipcRenderer.invoke('settings:reset-telegram')`. Update `TelegramSettings.jsx` to use `api.resetTelegramSettings()` instead of `api.invoke('settings:reset-telegram')`.

---

### 1.2 IPC handlers lack input validation

**File:** `desktop/main.js`

- **accounts:add (event, nickname):** If `nickname` is `undefined`, `null`, or not a string, the INSERT still runs (`acc_${Date.now()}`, nickname, …). SQLite/store may get invalid or confusing data; UI may show blank names.
- **accounts:delete (event, accountId):** No check that `accountId` exists in DB or matches format. Deleting a non-existent id still runs MessageMonitor.detach + Playwright.closeAccount + cleanupTx; transaction may delete nothing but no error is returned.
- **accounts:open (event, accountId):** No validation. Invalid id can cause PlaywrightManager.launchAccount to throw; error propagates to renderer.

**Recommendation:** Validate and sanitize:
- `accounts:add`: require `nickname` non-empty string, trim and length limit (e.g. 64 chars).
- `accounts:delete` / `accounts:open`: require `accountId` string matching `acc_\d+` and optionally check existence; return structured error to renderer instead of throwing.

---

### 1.3 Reply-service reaches into MessageMonitor internals

**File:** `desktop/services/reply-service.js` (lines 217–219)

```js
const state = MessageMonitor.accounts.get(accountId);
if (state) state._replySnapshot = new Map(state.sidebarState);
```

**Issue:** Depends on `MessageMonitor.accounts` (internal Map) and `state._replySnapshot` / `state.sidebarState`. If MessageMonitor changes structure or renames these, reply-service breaks without compile-time signal.

**Recommendation:** Add a small public API on MessageMonitor, e.g. `captureReplySnapshot(accountId)` that returns nothing and internally sets `_replySnapshot` from `sidebarState`. Reply-service calls that instead of touching `.accounts` and `.sidebarState`.

---

### 1.4 SessionMonitor uses PlaywrightManager internal `contexts`

**File:** `desktop/services/session-monitor.js` (line 80)

```js
const context = this.pm.contexts.get(acc.id);
```

**Issue:** PlaywrightManager’s `contexts` Map is an internal implementation detail. If PlaywrightManager is refactored to hide or replace it, SessionMonitor can break.

**Recommendation:** Add `PlaywrightManager.getPage(accountId)` (or `getContext(accountId)`) that returns the page or context for that account, or null. SessionMonitor uses that instead of `this.pm.contexts.get(acc.id)`.

---

## 2. Medium / unprofessional or brittle

### 2.1 Dead code in PollScheduler

**File:** `desktop/services/poll-scheduler.js` (lines 99–100)

```js
for (const { state } of this._registry.values ? [] : []) { /* unused */ }
```

**Issue:** Loop always iterates over `[]`; it does nothing and is misleading.

**Recommendation:** Remove these two lines.

---

### 2.2 Deprecated Playwright API

**File:** `desktop/services/playwright-manager.js` (line 157)

```js
await page.waitForTimeout(3000);
```

**Issue:** `waitForTimeout` is deprecated and may be removed in future Playwright versions.

**Recommendation:** Replace with `await new Promise(r => setTimeout(r, 3000))` or a shared `sleep(3000)` helper.

---

### 2.3 accounts:delete does not clean reply_queue / reply_context explicitly

**File:** `desktop/main.js` (cleanupTx in accounts:delete)

**Current:** Deletes `messages`, `conversations`, then `accounts`. Tables `reply_context` and `reply_queue` have `FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE` in schema, so SQLite will remove their rows when `accounts` is deleted.

**Issue:** If an older DB or a migration ever created these tables without CASCADE, orphan rows could remain. No functional bug today if schema is applied as-is.

**Recommendation:** Optional hardening: in the same transaction, run `DELETE FROM reply_context WHERE account_id = ?` and `DELETE FROM reply_queue WHERE account_id = ?` before deleting the account, so behavior is correct even without CASCADE on those tables.

---

### 2.4 Telegram sendMessage logs full chat_id

**File:** `desktop/services/telegram-bot.js` (line 85)

```js
console.log(`[Telegram] sendMessage → chat_id=${chatIdValue} (${typeof chatIdValue})`);
```

**Issue:** Logs every send with chat id. For multi-user or sensitive deployments, this can be undesirable.

**Recommendation:** In production builds, log only a redacted form (e.g. last 2 digits) or remove this log.

---

### 2.5 DB migration leaves foreign_keys OFF on error

**File:** `desktop/db/database.js` (messages CASCADE migration, lines 52–82)

**Current:** On exception after `foreign_keys = OFF`, the catch block runs `db.pragma('foreign_keys = ON')`, so FK is re-enabled. Good.

**Issue:** If an error occurs between `ALTER TABLE` and `COMMIT`, the messages table can be in an inconsistent state (e.g. _messages_old exists, new table partial). The code does not attempt rollback or recovery.

**Recommendation:** Document that in such a failure the app may need manual DB repair or re-run of migration. Optionally use a single transaction and ensure `foreign_keys = ON` in a `finally` block.

---

## 3. Low / nice to have

### 3.1 accounts:add — account created before Playwright launch

**File:** `desktop/main.js` (accounts:add)

**Current:** INSERT creates the account with status `'active'` before `launchAccount` is called. If `launchAccount` throws, the account remains in DB as active.

**Recommendation:** Consider inserting with status `'pending'` or `'launching'`, then updating to `'active'` (or `'offline'` / `'needs_login'`) after first successful identity check or headless launch.

---

### 3.2 isDuplicate key is global (no accountId)

**File:** `desktop/services/message-monitor.js` (isDuplicate)

**Current:** Dedup key is `sender|body` (first 80 chars). Two different accounts receiving the same message from senders with the same name will share the same key; the second within 30s is deduped.

**Impact:** Rare: only if two accounts get an identical message (same sender name + body) within 30s. Then only one notification is sent.

**Recommendation:** Optional: include `accountId` in the key so dedupe is per-account: `accountId|sender|body`. Trade-off: slightly more memory and more notifications in that edge case.

---

### 3.3 No explicit cleanup of pendingTelegram on detach

**File:** `desktop/services/message-monitor.js` (detach)

**Current:** When an account is detached, `_pendingTelegram` is not cleared for that accountId. Pending entries for that account will expire after 5s (TTL).

**Impact:** Minor; entries are bounded and short-lived.

**Recommendation:** Optional: in `detach(accountId)`, remove any `_pendingTelegram` entries for that accountId to avoid sending a notification for a detached account if the poll runs before TTL.

---

## 4. Summary table

| Severity   | Item                                      | File(s)                    | May break / unprofessional?     |
|-----------|-------------------------------------------|----------------------------|----------------------------------|
| Critical  | Generic `invoke` in preload               | preload.js                 | Yes — security + stability      |
| Critical  | No IPC input validation                   | main.js                    | Yes — bad input can cause errors |
| Critical  | Reply-service uses MessageMonitor internals | reply-service.js         | Yes — refactor can break it     |
| Critical  | SessionMonitor uses pm.contexts           | session-monitor.js         | Yes — refactor can break it     |
| Medium    | Dead code in PollScheduler                | poll-scheduler.js          | No — cleanup only               |
| Medium    | Deprecated waitForTimeout                 | playwright-manager.js      | Yes — future Playwright drop     |
| Medium    | Optional: explicit delete reply_queue/context on account delete | main.js | No — CASCADE already in place |
| Medium    | Telegram chat_id logging                  | telegram-bot.js            | Privacy / polish                 |
| Low       | Account status on add                     | main.js                    | Edge case only                  |
| Low       | isDuplicate global key                    | message-monitor.js         | Edge case only                  |
| Low       | pendingTelegram on detach                 | message-monitor.js         | Minor                           |

---

## 5. Recommended order of fixes

1. **Preload:** Remove generic `invoke`; add `resetTelegramSettings` and use it in TelegramSettings.
2. **PollScheduler:** Remove the dead loop (lines 99–100).
3. **Playwright:** Replace `page.waitForTimeout(3000)` with `await new Promise(r => setTimeout(r, 3000))`.
4. **main.js IPC:** Add validation for `nickname`, `accountId` (format and optionally existence) on accounts:add, accounts:delete, accounts:open; return clear errors to renderer.
5. **Reply-service / SessionMonitor:** Introduce small public APIs on MessageMonitor and PlaywrightManager and use them instead of reaching into internals.

After that, optional: explicit deletes for reply_queue/reply_context on account delete, logging and status-on-add tweaks, and pendingTelegram cleanup on detach.
