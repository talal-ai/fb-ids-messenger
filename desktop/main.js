const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const store = new Store();

// Set a friendly application name (affects menu on macOS, window title fallback etc.)
app.name = 'Multi FB Manager';

// Windows: ensure the running window's taskbar icon matches the installed
// shortcut. Must equal the NSIS shortcut AppUserModelID, which electron-builder
// derives from `build.appId` in package.json.
if (process.platform === 'win32') {
    app.setAppUserModelId('com.multi-fb.manager');
}

// Services
const Database = require('./db/database');
const PlaywrightManager = require('./services/playwright-manager');
const MessageMonitor = require('./services/message-monitor');
const TelegramBot = require('./services/telegram-bot');
const SessionMonitor = require('./services/session-monitor');
const PollScheduler = require('./services/poll-scheduler');
const NotificationOutbox = require('./services/notification-outbox');
const NotificationSender = require('./services/notification-sender');
const ReplyService = require('./services/reply-service');
// Permanent reverse tunnel to our VPS (replaces ephemeral Cloudflare quick-tunnel).
// Kept the CloudflaredManager name to minimise churn across the cloud:* handlers.
const CloudflaredManager = require('./services/frpc-manager');
const controlPlane = require('../control-plane');

// Let the tunnel read VPS overrides (frp_server_addr, frp_token, …) from settings.
CloudflaredManager.setConfigSource((key) => store.get(key));

// Default control-plane Bearer token. Must match the mobile app's DEFAULT_API_TOKEN
// (mobile/lib/client-config.ts) so the paired apps work out of the box. A token set
// in Settings → Control Plane Token always overrides this.
const DEFAULT_CONTROL_PLANE_TOKEN = '58649e16c9a9a50b17b49cd5cd90527c4575a73f9386c896';

let mainWindow;
let controlPlaneServer = null;
let updaterInitialized = false;
let updaterEnabled = false;
let cloudTunnelUrl = null;
let updaterState = {
    status: 'idle',
    message: 'Idle',
    updateInfo: null,
    progress: null,
    checkedAt: null,
    error: null
};

function mapUpdaterError(err) {
    const rawMessage = err?.message || String(err || 'Unknown updater error');

    if (
        rawMessage.includes('Unable to find latest version on GitHub') ||
        rawMessage.includes('Cannot parse releases feed')
    ) {
        return {
            status: 'misconfigured',
            message: 'Updater feed is not published yet',
            error: 'Publish a production GitHub Release (with latest.yml assets) or disable auto-updates for this build.'
        };
    }

    return {
        status: 'error',
        message: 'Update check failed',
        error: rawMessage
    };
}

function publishUpdaterState(partialState) {
    updaterState = {
        ...updaterState,
        ...partialState
    };

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:state', updaterState);
    }
}

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

function createWindow(isDev) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '..', process.platform === 'win32' ? 'logo.ico' : 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // In development we usually load the Vite server, but opening the devtools
  // can be noisy for end users – allow disabling via `OPEN_DEVTOOLS`.
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

function setupAutoUpdater() {
    if (updaterInitialized) return;
    updaterInitialized = true;

  log.transports.file.level = 'info';
  autoUpdater.logger = log;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => {
        log.info('[Updater] Checking for update');
        publishUpdaterState({
                status: 'checking',
                message: 'Checking for updates...',
                checkedAt: Date.now(),
                error: null
        });
    });
    autoUpdater.on('update-available', (info) => {
        log.info('[Updater] Update available', info);
        publishUpdaterState({
                status: 'available',
                message: `Newer version v${info.version} found`,
                updateInfo: info,
                progress: null,
                error: null,
                checkedAt: Date.now()
        });
    });
    autoUpdater.on('update-not-available', (info) => {
        log.info('[Updater] No update available', info);
        publishUpdaterState({
                status: 'not-available',
                message: `Version v${app.getVersion()} already installed (up to date)`,
                updateInfo: info || null,
                progress: null,
                error: null,
                checkedAt: Date.now()
        });
    });
  autoUpdater.on('download-progress', (progressObj) => {
        publishUpdaterState({
                status: 'downloading',
                message: `Downloading ${progressObj.percent.toFixed(1)}%`,
                progress: progressObj,
                error: null
        });
    log.info('[Updater] Download speed', progressObj.bytesPerSecond);
    log.info('[Updater] Downloaded', progressObj.percent, '%');
    log.info('[Updater] Total', progressObj.total, 'bytes');
    log.info('[Updater] Transferred', progressObj.transferred, 'bytes');
  });
    autoUpdater.on('update-downloaded', (info) => {
        log.info('[Updater] Update downloaded; waiting for user to restart and install');
        publishUpdaterState({
                status: 'downloaded',
                message: `Version ${info.version} is ready to install`,
                updateInfo: info,
                progress: null,
                error: null
        });
  });
    autoUpdater.on('error', (err) => {
        log.error('[Updater] Error', err);
        publishUpdaterState(mapUpdaterError(err));
    });
}

app.whenReady().then(() => {
    const isDev = !app.isPackaged;
    createWindow(isDev);

    if (!isDev) {
            updaterEnabled = true;
      setupAutoUpdater();

            const runUpdateCheck = () => {
                    autoUpdater.checkForUpdates().catch((err) => {
                            log.error('[Updater] Background check failed', err);
                            publishUpdaterState(mapUpdaterError(err));
                    });
            };

            // Initial check ~10s after launch — lets the renderer mount and subscribe
            // to updater:state first so the very first event is not lost.
            setTimeout(runUpdateCheck, 10_000);

            // Re-check every 30 minutes for long-running sessions.
            setInterval(runUpdateCheck, 30 * 60 * 1000);
    }

    // Wire MessageMonitor to mainWindow + Telegram
    MessageMonitor.setMainWindow(mainWindow);
    MessageMonitor.setTelegramBot(TelegramBot);

    // Durable notification sender (Expo Push primary, Telegram fallback)
    NotificationSender.init({
        telegramSender: (notifData, context) => TelegramBot.sendNotification(notifData, context),
        store,
    });
    NotificationOutbox.setSender((notifData, context) => NotificationSender.send(notifData, context));
    NotificationOutbox.start();

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
        await ReplyService.recoverPendingReplies();
    })();

    // Start poll scheduler (central staggered polling for all accounts)
    PollScheduler.start();

    // Start session health monitor (checks every 8 min for expired sessions + heartbeat)
    const sessionMonitor = new SessionMonitor(PlaywrightManager, Database, TelegramBot);
    sessionMonitor.start();

    // Control-plane API (enabled by default — mobile app needs it)
    try {
        const cpDisabled = store.get('control_plane_http_disabled') === true;
        const cpToken = (store.get('control_plane_token') || process.env.CONTROL_PLANE_TOKEN || DEFAULT_CONTROL_PLANE_TOKEN || '').trim();
        if (!cpDisabled && cpToken) {
            const cpPort = Number(store.get('control_plane_http_port') || process.env.CONTROL_PLANE_HTTP_PORT || 3847);
            controlPlaneServer = controlPlane.startHttpServer({
                port: cpPort,
                token: cpToken,
                getDb: () => Database.getDb(),
                queueReplyFromCommand: (opts) => ReplyService.queueReplyFromCommand(opts),
                syncConversation: async (accountId, conversationId) => {
                    try {
                        const messages = await PlaywrightManager.fetchHistory(accountId, conversationId);
                        const db = Database.getDb();
                        const tx = db.transaction((msgs) => {
                            for (const m of msgs) {
                                const id = `msg_sync_${conversationId}_${m.timestamp}_${Math.random().toString(36).substring(2, 6)}`;
                                db.prepare(`
                                    INSERT OR IGNORE INTO messages (id, conversation_id, account_id, sender_name, body, timestamp, is_outgoing)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)
                                `).run(id, conversationId, accountId, m.senderName, m.body, m.timestamp, m.isOutgoing);
                            }
                        });
                        tx(messages);
                        return { ok: true, count: messages.length };
                    } catch (err) {
                        return { ok: false, error: err.message };
                    }
                }
            });

            // Auto-start the permanent reverse tunnel so the mobile app can reach
            // this PC on every launch — the operator never has to click "Enable".
            // The public URL is fixed, so this re-establishes the SAME backend each time.
            if (store.get('cloud_autostart') !== false) {
                CloudflaredManager.quickConnect(cpPort, (step, message) => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('cloud:progress', { step, message });
                    }
                }).then((res) => {
                    if (res.success && res.url) {
                        cloudTunnelUrl = res.url;
                        console.log('[Tunnel] Auto-connected:', res.url);
                    } else {
                        console.warn('[Tunnel] Auto-connect failed:', res.error);
                    }
                }).catch((e) => console.warn('[Tunnel] Auto-connect error:', e.message));
            }
        } else if (!cpToken) {
            console.log(
                '[ControlPlane] HTTP not started — set control_plane_token in settings or CONTROL_PLANE_TOKEN env var.'
            );
        }
    } catch (e) {
        console.error('[ControlPlane] Failed to start HTTP:', e.message);
    }
    // Expose so watchdog can clear alerts on successful relaunch
    app._sessionMonitor = sessionMonitor;
});

app.on('window-all-closed', async () => {
    PollScheduler.stop();
    NotificationOutbox.stop();
    // Tear down the reverse tunnel so the server frees our proxy slot immediately.
    // Without this, frpc can be orphaned on Windows and keep holding the slot,
    // making the next launch fail with "proxy already exists".
    try { await CloudflaredManager.stop(); } catch (_) {}
    if (controlPlaneServer) {
        try {
            controlPlaneServer.close();
        } catch (_) {}
        controlPlaneServer = null;
    }
    await PlaywrightManager.closeAll();
    if (process.platform !== 'darwin') app.quit();
});

// Belt-and-suspenders: also stop the tunnel on quit paths that bypass
// window-all-closed (e.g. app relaunch, Cmd-Q on macOS).
app.on('before-quit', () => {
    try { CloudflaredManager.stop(); } catch (_) {}
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
                    NotificationOutbox.enqueue(
                        { senderName: '⚙️ System', body: `Auto-Recovery: browser context lost. Relaunching now.`, accountId: acc.id, accountLabel: label, timestamp: Date.now() },
                        null
                    );
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
    if (nickname == null || typeof nickname !== 'string') {
        return { error: 'Nickname is required' };
    }
    const trimmed = nickname.trim();
    if (trimmed === '') {
        return { error: 'Nickname cannot be empty' };
    }
    const nicknameToUse = trimmed.length > 64 ? trimmed.slice(0, 64) : trimmed;

    const id = `acc_${Date.now()}`;
    const db = Database.getDb();

    // 1. Create DB entry (status active because we'll start a session immediately)
    db.prepare('INSERT INTO accounts (id, nickname, profile_dir, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, nicknameToUse, id, 'active', Date.now());

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

    return { id, nickname: nicknameToUse, status: 'active' };
});

ipcMain.handle('accounts:delete', async (event, accountId) => {
    if (accountId == null || typeof accountId !== 'string' || !/^acc_\d+$/.test(accountId)) {
        return { error: 'Invalid account ID' };
    }
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
        db.prepare('DELETE FROM reply_context WHERE account_id = ?').run(id);
        db.prepare('DELETE FROM reply_queue WHERE account_id = ?').run(id);
        db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    });
    cleanupTx(accountId);

    console.log(`[Main] Account ${accountId} and all its data deleted`);
    return true;
});

ipcMain.handle('accounts:open', async (event, accountId) => {
    if (accountId == null || typeof accountId !== 'string' || !/^acc_\d+$/.test(accountId)) {
        return { error: 'Invalid account ID' };
    }
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

let _cpRestartTimer = null;

function notifyControlPlaneStatus(msg) {
    try {
        const wins = require('electron').BrowserWindow.getAllWindows();
        if (wins[0]) wins[0].webContents.send('control-plane:status', msg);
    } catch (_) {}
}

function restartControlPlane() {
    if (_cpRestartTimer) clearTimeout(_cpRestartTimer);
    _cpRestartTimer = setTimeout(() => {
        _cpRestartTimer = null;
        try {
            if (controlPlaneServer) {
                controlPlaneServer.close();
                controlPlaneServer = null;
                notifyControlPlaneStatus('stopping');
            }
            const cpToken = (store.get('control_plane_token') || '').trim();
            const cpPort = Number(store.get('control_plane_http_port') || 3847);
            if (cpToken) {
                controlPlaneServer = controlPlane.startHttpServer({
                    port: cpPort,
                    token: cpToken,
                    getDb: () => Database.getDb(),
                    queueReplyFromCommand: (opts) => ReplyService.queueReplyFromCommand(opts),
                });
                notifyControlPlaneStatus(`running:${cpPort}`);
            } else {
                notifyControlPlaneStatus('no-token');
            }
        } catch (err) {
            notifyControlPlaneStatus(`error:${err.message}`);
        }
    }, 500);
}

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
    if (key === 'control_plane_token' || key === 'control_plane_http_port') {
        restartControlPlane();
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

// Sync history from Facebook
ipcMain.handle('conversations:sync', async (event, accountId, conversationId) => {
    try {
        console.log(`[Main] Syncing history for ${accountId} / ${conversationId}`);
        const messages = await PlaywrightManager.fetchHistory(accountId, conversationId);
        
        const db = Database.getDb();
        const tx = db.transaction((msgs) => {
            for (const m of msgs) {
                const id = `msg_sync_${conversationId}_${m.timestamp}_${Math.random().toString(36).substring(2, 6)}`;
                db.prepare(`
                    INSERT OR IGNORE INTO messages (id, conversation_id, account_id, sender_name, body, timestamp, is_outgoing)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(id, conversationId, accountId, m.senderName, m.body, m.timestamp, m.isOutgoing);
            }
        });
        tx(messages);
        
        return { ok: true, count: messages.length };
    } catch (err) {
        console.error('[Main] History sync failed:', err.message);
        return { ok: false, error: err.message };
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
                     COALESCE(NULLIF(TRIM(a.nickname), ''), NULLIF(TRIM(a.fb_name), ''), m.account_id) as accountNickname
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

ipcMain.handle('app:version', () => {
    return app.getVersion();
});

ipcMain.handle('updater:get-state', () => {
    return updaterState;
});

ipcMain.handle('updater:check', async () => {
    if (!updaterEnabled) {
        publishUpdaterState({
            status: 'unsupported',
            message: 'Updates are available only in packaged builds.'
        });
        return updaterState;
    }

    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        publishUpdaterState(mapUpdaterError(err));
    }
    return updaterState;
});

ipcMain.handle('updater:download', async () => {
    if (!updaterEnabled) {
        publishUpdaterState({
            status: 'unsupported',
            message: 'Updates are available only in packaged builds.'
        });
        return updaterState;
    }

    publishUpdaterState({
        status: 'downloading',
        message: 'Starting download...'
    });

    try {
        await autoUpdater.downloadUpdate();
    } catch (err) {
        publishUpdaterState({
            status: 'error',
            message: 'Download failed',
            error: err?.message || String(err)
        });
    }
    return updaterState;
});

ipcMain.handle('updater:install', () => {
    if (!updaterEnabled) {
        return { ok: false, error: 'Updates are available only in packaged builds.' };
    }
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
});

// ============================================================================
// Cloud Access (permanent FRP reverse tunnel to VPS) — fixed public URL
// ============================================================================

ipcMain.handle('cloud:get-status', () => {
    const status = CloudflaredManager.getStatus();
    return {
        running: status.running,
        url: status.url,
        localPort: store.get('control_plane_http_port') || 3847
    };
});

ipcMain.handle('cloud:enable', async () => {
    const localPort = store.get('control_plane_http_port') || 3847;
    
    // Ensure control plane is running
    if (!controlPlaneServer) {
        const cpToken = (store.get('control_plane_token') || DEFAULT_CONTROL_PLANE_TOKEN || '').trim();
        if (!cpToken) {
            return { success: false, error: 'Set Control Plane Token in Settings first' };
        }
        controlPlaneServer = controlPlane.startHttpServer({
            port: localPort,
            token: cpToken,
            getDb: () => Database.getDb(),
            queueReplyFromCommand: (opts) => ReplyService.queueReplyFromCommand(opts),
            syncConversation: async (accountId, conversationId) => {
                try {
                    const messages = await PlaywrightManager.fetchHistory(accountId, conversationId);
                    const db = Database.getDb();
                    const tx = db.transaction((msgs) => {
                        for (const m of msgs) {
                            const id = `msg_sync_${conversationId}_${m.timestamp}_${Math.random().toString(36).substring(2, 6)}`;
                            db.prepare(`
                                INSERT OR IGNORE INTO messages (id, conversation_id, account_id, sender_name, body, timestamp, is_outgoing)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `).run(id, conversationId, accountId, m.senderName, m.body, m.timestamp, m.isOutgoing ? 1 : 0);
                        }
                    });
                    tx(messages);
                    return { ok: true, count: messages.length };
                } catch (err) {
                    return { ok: false, error: err.message };
                }
            }
        });
    }
    
    const result = await CloudflaredManager.quickConnect(localPort, (step, message) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('cloud:progress', { step, message });
        }
    });
    if (result.success && typeof result.url === 'string' && result.url.trim()) {
        cloudTunnelUrl = result.url;
        // Auto-save the URL to clipboard for easy sharing
        const { clipboard } = require('electron');
        clipboard.writeText(result.url);
    } else if (result.success) {
        return {
            success: false,
            error: 'Tunnel started but no public URL was returned. Please try again.'
        };
    }
    return result;
});

ipcMain.handle('cloud:disable', async () => {
    await CloudflaredManager.stop();
    cloudTunnelUrl = null;
    return { success: true };
});

ipcMain.handle('cloud:get-url', () => {
    return { url: CloudflaredManager.getStatus().url };
});
