const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const store = new Store();

// Set a friendly application name (affects menu on macOS, window title fallback etc.)
app.name = 'Multi FB Manager';

// Services
const Database = require('./db/database');
const PlaywrightManager = require('./services/playwright-manager');
const MessageMonitor = require('./services/message-monitor');
const TelegramBot = require('./services/telegram-bot');
const SessionMonitor = require('./services/session-monitor');
const PollScheduler = require('./services/poll-scheduler');

let mainWindow;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

// Initialize DB
Database.initDatabase();

// Weekly VACUUM + ANALYZE — keeps the SQLite file compact as messages accumulate
try {
    const lastVacuum = store.get('last_db_vacuum') || 0;
    if (Date.now() - lastVacuum > 7 * 24 * 60 * 60 * 1000) {
        Database.getDb().exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; ANALYZE;');
        store.set('last_db_vacuum', Date.now());
        console.log('[DB] Weekly VACUUM complete');
    }
} catch (e) { /* non-fatal */ }

// One-time cleanup: remove false-positive messages (dot/trivial bodies) left by old scanner
try {
    const cleaned = Database.getDb()
        .prepare(`DELETE FROM messages WHERE length(trim(body)) < 2 OR body GLOB '*[·•…]*' OR trim(body) = '.'`)
        .run();
    if (cleaned.changes > 0) console.log(`[DB] Cleaned ${cleaned.changes} trivial false-positive message(s)`);
} catch (e) { /* ignore — runs once on startup */ }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // `app.isPackaged` is true when running a packaged build. We also respect
  // NODE_ENV so that tests or other environments can override behaviour. In
  // development we usually load the Vite server, but opening the devtools
  // can be noisy for end users – allow disabling via `OPEN_DEVTOOLS`.
  const isDev = (!app.isPackaged || process.env.NODE_ENV === 'development');
  if (isDev) {
    mainWindow.loadURL('http://localhost:3005');
    if (process.env.OPEN_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // ensure the window carries the correct product name
  mainWindow.setTitle('Multi FB Manager');

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
    createWindow();

    // Wire MessageMonitor to mainWindow + Telegram
    MessageMonitor.setMainWindow(mainWindow);
    MessageMonitor.setTelegramBot(TelegramBot);

    // Start Telegram Bot if configured
    const botToken = store.get('telegram_token');
    const chatId = store.get('telegram_chat_id');
    const proxy = store.get('telegram_proxy');
    if (botToken && chatId) {
        try {
            TelegramBot.initBot(botToken, chatId, proxy);
        } catch (err) {
            console.error('[Main] Failed to init bot:', err);
        }
    }

    // Restore accounts in the background — do NOT await so the window opens immediately
    (async () => {
        const accounts = Database.getDb().prepare('SELECT * FROM accounts').all();

        // ── Batched launch: 5 accounts at a time to avoid 30-simultaneous-spawn disk/CPU spike
        const LAUNCH_BATCH_SIZE = 5;
        const LAUNCH_BATCH_DELAY_MS = 2000;

        async function restoreAccount(acc) {
            console.log(`[Main] Restoring session for ${acc.id}`);
            try {
                await PlaywrightManager.launchAccount(acc.id, true);
                const page = await PlaywrightManager.getMessengerPage(acc.id);
                await MessageMonitor.attach(page, acc.id);

                // Validate login exists
                const identity = await PlaywrightManager.extractFbIdentity(acc.id);
                if (identity && (identity.fbName || identity.fbUserId)) {
                    Database.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('active', acc.id);
                } else {
                    Database.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('needs_login', acc.id);
                    console.log(`[Main] Restored ${acc.id} but no active FB session`);
                }

                // If we don't already have identity info in db, save it
                if ((!acc.fb_name || !acc.fb_user_id) && identity) {
                    const db = Database.getDb();
                    if (identity.fbName) db.prepare('UPDATE accounts SET fb_name = ? WHERE id = ?').run(identity.fbName, acc.id);
                    if (identity.fbUserId) db.prepare('UPDATE accounts SET fb_user_id = ? WHERE id = ?').run(identity.fbUserId, acc.id);
                }
            } catch (err) {
                console.error(`[Main] Failed to restore ${acc.id}:`, err);
                Database.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('offline', acc.id);
            }
        }

        for (let i = 0; i < accounts.length; i += LAUNCH_BATCH_SIZE) {
            const batch = accounts.slice(i, i + LAUNCH_BATCH_SIZE);
            console.log(`[Main] Launching batch ${Math.floor(i / LAUNCH_BATCH_SIZE) + 1}: accounts ${i + 1}-${Math.min(i + LAUNCH_BATCH_SIZE, accounts.length)} of ${accounts.length}`);
            await Promise.all(batch.map(acc => restoreAccount(acc)));
            // Brief pause between batches to avoid I/O spike
            if (i + LAUNCH_BATCH_SIZE < accounts.length) {
                await new Promise(r => setTimeout(r, LAUNCH_BATCH_DELAY_MS));
            }
        }

        // Recover any replies that were pending when the app last shut down / crashed
        const ReplyService = require('./services/reply-service');
        await ReplyService.recoverPendingReplies();
    })();

    // Start poll scheduler (central staggered polling for all accounts)
    PollScheduler.start();

    // Start session health monitor (checks every 8 min for expired sessions + heartbeat)
    const sessionMonitor = new SessionMonitor(PlaywrightManager, Database, TelegramBot);
    sessionMonitor.start();
    // Expose so watchdog can clear alerts on successful relaunch
    app._sessionMonitor = sessionMonitor;
});

app.on('window-all-closed', async () => {
    PollScheduler.stop();
    await PlaywrightManager.closeAll();
    if (process.platform !== 'darwin') app.quit();
});

// ============================================================================
// Headless relaunch helper with retry
// ============================================================================
const HEADLESS_RETRY_COUNT = 3;
const HEADLESS_RETRY_DELAY_MS = 2000;

async function launchHeadlessWithRetry(accountId) {
    for (let attempt = 1; attempt <= HEADLESS_RETRY_COUNT; attempt++) {
        try {
            console.log(`[Main] Headless launch attempt ${attempt}/${HEADLESS_RETRY_COUNT} for ${accountId}`);
            // Clean up any stale context reference
            PlaywrightManager.removeContext(accountId);
            MessageMonitor.detach(accountId);

            const ctx = await PlaywrightManager.launchAccount(accountId, true);
            const page = await PlaywrightManager.getMessengerPage(accountId);
            await MessageMonitor.attach(page, accountId);

            const identity = await PlaywrightManager.extractFbIdentity(accountId);
            if (identity && (identity.fbName || identity.fbUserId)) {
                Database.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('active', accountId);
                if (identity.fbName) Database.getDb().prepare('UPDATE accounts SET fb_name = ? WHERE id = ?').run(identity.fbName, accountId);
                if (identity.fbUserId) Database.getDb().prepare('UPDATE accounts SET fb_user_id = ? WHERE id = ?').run(identity.fbUserId, accountId);
            } else {
                Database.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('needs_login', accountId);
            }
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('accounts-updated');
            // Clear the session-expiry alert flag so future expiry re-alerts properly
            if (app._sessionMonitor) app._sessionMonitor.clearAlert(accountId);
            console.log(`[Main] Headless launch SUCCESS for ${accountId} on attempt ${attempt}`);
            return true;
        } catch (err) {
            console.error(`[Main] Headless launch attempt ${attempt} FAILED for ${accountId}:`, err.message);
            if (attempt < HEADLESS_RETRY_COUNT) {
                await new Promise(r => setTimeout(r, HEADLESS_RETRY_DELAY_MS));
            }
        }
    }
    // All retries exhausted
    console.error(`[Main] All ${HEADLESS_RETRY_COUNT} headless launch attempts FAILED for ${accountId}`);
    Database.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('offline', accountId);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('accounts-updated');
    return false;
}

// ============================================================================
// Watchdog: periodically check all active accounts have working contexts
// ============================================================================
const WATCHDOG_INTERVAL_MS = 60_000; // every 60 seconds

setInterval(async () => {
    try {
        const accounts = Database.getDb().prepare("SELECT * FROM accounts WHERE status = 'active'").all();
        for (const acc of accounts) {
            if (!PlaywrightManager.hasContext(acc.id)) {
                const label = acc.fb_name || acc.nickname || acc.id;
                console.warn(`[Watchdog] Account ${acc.id} (${label}) has no browser context — alerting + relaunching...`);
                // Notify operator via Telegram so they know a recovery is happening
                try {
                    const esc = (t) => (t || '').replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
                    TelegramBot.sendNotification(
                        `🔄 *Auto\\-Recovery*\n\nAccount: ${esc(label)} \\(${esc(acc.id)}\\)\nBrowser context was lost\\. Relaunching now\\.`,
                        null
                    ).catch(() => {});
                } catch (_) {}
                await launchHeadlessWithRetry(acc.id);
            }
        }
    } catch (err) {
        console.error('[Watchdog] Error during health check:', err.message);
    }
}, WATCHDOG_INTERVAL_MS);

// ============================================================================
// IPC Handlers
// ============================================================================

// Accounts
ipcMain.handle('accounts:list', () => {
    return Database.getDb().prepare('SELECT * FROM accounts').all();
});

ipcMain.handle('accounts:add', async (event, nickname) => {
    const id = `acc_${Date.now()}`;
    const db = Database.getDb();
    
    // 1. Create DB entry (status active because we'll start a session immediately)
    db.prepare('INSERT INTO accounts (id, nickname, profile_dir, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, nickname, id, 'active', Date.now());

    // 2. Launch Visible Window for Login
    //    We open a non-headless Playwright context so the user can authenticate manually.
    const context = await PlaywrightManager.launchAccount(id, false);
    const page = await PlaywrightManager.getMessengerPage(id);

    // 3. In the background, watch for successful login and then convert to headless.
    //    This ensures the browsing context remains persistent (cookies saved to disk)
    //    and notifications continue even if the user closes the login window.
    (async () => {
        let loggedIn = false;
        for (let attempt = 0; attempt < 40 && !loggedIn; attempt++) {
            await new Promise(r => setTimeout(r, 5000)); // check every 5s
            try {
                // Check if context is still alive (user may have closed window)
                if (!PlaywrightManager.hasContext(id)) {
                    console.log(`[Main] Context closed for ${id} during login wait`);
                    break;
                }
                const identity = await PlaywrightManager.extractFbIdentity(id);
                if (identity && (identity.fbUserId || identity.fbName)) {
                    loggedIn = true;
                    console.log(`[Main] Login detected for ${id} (${identity.fbName||identity.fbUserId})`);
                    // update db with identity if not stored
                    const upd = Database.getDb();
                    if (identity.fbName) upd.prepare('UPDATE accounts SET fb_name = ? WHERE id = ?').run(identity.fbName, id);
                    if (identity.fbUserId) upd.prepare('UPDATE accounts SET fb_user_id = ? WHERE id = ?').run(identity.fbUserId, id);
                    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('accounts-updated');
                }
            } catch (e) {
                // context may have closed if user manually closed the window
                console.log(`[Main] check-login: context closed for ${id}, will attempt headless restart`);
                break;
            }
        }

        // Close visible browser and switch to headless
        try {
            MessageMonitor.detach(id);
            await PlaywrightManager.closeAccount(id);
            // brief pause to let profile data flush to disk before next launch
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) { /* ignore */ }

        console.log(`[Main] Switching ${id} to headless mode`);
        await launchHeadlessWithRetry(id);
    })();

    return { id, nickname, status: 'active' };
});

ipcMain.handle('accounts:delete', async (event, accountId) => {
    // 1. Stop monitoring + close browser
    MessageMonitor.detach(accountId);
    await PlaywrightManager.closeAccount(accountId);

    const db = Database.getDb();
    // 2. Explicitly delete child rows in a transaction.
    //    This handles both new installs (where foreign_keys CASCADE is active)
    //    and existing installs (where CASCADE was not enforced before this fix).
    const cleanupTx = db.transaction((id) => {
        db.prepare('DELETE FROM messages WHERE account_id = ?').run(id);
        db.prepare('DELETE FROM conversations WHERE account_id = ?').run(id);
        db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    });
    cleanupTx(accountId);

    console.log(`[Main] Account ${accountId} and all its data deleted`);
    return true;
});

ipcMain.handle('accounts:open', async (event, accountId) => {
    console.log(`[Main] Opening window for ${accountId}`);
    // Detach monitoring from old headless context (will be destroyed)
    MessageMonitor.detach(accountId);
    const context = await PlaywrightManager.launchAccount(accountId, false); // false = visible
    const page = await PlaywrightManager.getMessengerPage(accountId);
    try {
        await page.bringToFront();
    } catch (e) {
        console.warn(`[Main] bringToFront failed (page may have been recreated):`, e.message);
    }

    // Re-attach monitoring on the visible page so messages are still captured
    await MessageMonitor.attach(page, accountId);

    // update status in case it was offline
    Database.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('active', accountId);

    // When the user closes the visible window, relaunch headless and re-attach monitoring
    context.on('close', async () => {
        console.log(`[Main] Visible window closed for ${accountId}, switching back to headless`);
        // Detach monitor from the now-dead page
        MessageMonitor.detach(accountId);
        // Clean up the dead context reference
        PlaywrightManager.removeContext(accountId);
        // Brief pause to let profile data flush to disk
        await new Promise(r => setTimeout(r, 1000));
        // Relaunch with retry
        await launchHeadlessWithRetry(accountId);
    });

    return true;
});

// Settings / Telegram
ipcMain.handle('settings:get', (event, key) => {
    return store.get(key);
});

let _telegramRestartTimer = null;

ipcMain.handle('settings:save', (event, key, value) => {
    store.set(key, value);
    // Debounce bot restart — UI saves token, chatId, proxy in quick succession
    if (key.startsWith('telegram_')) {
        if (_telegramRestartTimer) clearTimeout(_telegramRestartTimer);
        _telegramRestartTimer = setTimeout(() => {
            _telegramRestartTimer = null;
            const token = store.get('telegram_token');
            const chatId = store.get('telegram_chat_id');
            const proxy = store.get('telegram_proxy');
            if (token && chatId) {
                try {
                    TelegramBot.initBot(token, chatId, proxy);
                } catch (err) {
                    console.error('[Main] Failed to init bot:', err);
                }
            }
        }, 1500);
    }
});

ipcMain.handle('settings:reset-telegram', () => {
    store.delete('telegram_token');
    store.delete('telegram_chat_id');
    store.delete('telegram_proxy');
    // Stop bot if running
    TelegramBot.initBot(null, null, null);
    return true;
});

// Dashboard Data
ipcMain.handle('stats:get-summary', () => {
    try {
        const db = Database.getDb();
        const accounts = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
        const messages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
        const conversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
        const unread = db.prepare('SELECT COUNT(*) as count FROM conversations WHERE unread_count > 0').get().count;
        return { totalMessages: messages, totalConversations: conversations, activeAccounts: accounts, unreadCount: unread };
    } catch (err) {
        console.error('[Main] stats:get-summary error:', err.message);
        return { totalMessages: 0, totalConversations: 0, activeAccounts: 0, unreadCount: 0 };
    }
});

// Notifications / Messages History
ipcMain.handle('notifications:get', () => {
    try {
        const db = Database.getDb();
        // Fetch last 50 incoming messages, using fb_name (real Facebook name) preferably
        const msgs = db.prepare(`
            SELECT m.id, m.conversation_id, m.sender_name, m.body as messagePreview, m.timestamp,
                   m.account_id as accountId,
                   COALESCE(a.fb_name, a.nickname) as accountNickname
            FROM messages m
            LEFT JOIN accounts a ON m.account_id = a.id
            WHERE m.is_outgoing = 0
            ORDER BY m.timestamp DESC
            LIMIT 50
        `).all();
        return msgs.map(m => ({ ...m, read: false }));
    } catch (error) {
        console.error('[Main] Failed to get notifications:', error);
        return [];
    }
});

ipcMain.handle('notifications:clear', () => {
    return true;
});

ipcMain.handle('telegram:test', () => {
    const token = store.get('telegram_token');
    const chatId = store.get('telegram_chat_id');
    const proxy = store.get('telegram_proxy');
    console.log('[Main] telegram:test invoked with', { token: token ? '***' : null, chatId, proxy: proxy ? '***' : null });
    return TelegramBot.sendTestMessage(token, chatId, proxy);
});

ipcMain.handle('telegram:detect-chat', async () => {
    const token = store.get('telegram_token');
    const proxy = store.get('telegram_proxy');
    const result = await TelegramBot.detectChatId(token, proxy);
    if (result.success) {
        // Save detected chat id automatically to settings
        store.set('telegram_chat_id', result.chatId);
    }
    return result;
});
