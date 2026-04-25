#!/usr/bin/env node
/**
 * Headless server launcher — runs the full stack WITHOUT Electron.
 *
 * Deploy on a Linux VPS or Windows Server machine so the mobile app
 * can reach it from anywhere on the planet.
 *
 * Required env vars:
 *   CONTROL_PLANE_TOKEN   Bearer token the mobile app uses to authenticate
 *
 * Optional env vars:
 *   FB_DATA_DIR           SQLite DB + browser profiles storage path
 *                         Default: ~/.fb-ids-messenger  (Linux/Mac)
 *                                  %USERPROFILE%\.fb-ids-messenger  (Windows)
 *   CONTROL_PLANE_PORT    HTTP port for the API (default: 3847)
 *   TELEGRAM_BOT_TOKEN    Telegram bot token for alerts (optional)
 *   TELEGRAM_CHAT_ID      Telegram chat/group ID (optional)
 */

'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

// ── Validate required config ──────────────────────────────────────────────────
const CONTROL_PLANE_TOKEN = (process.env.CONTROL_PLANE_TOKEN || '').trim();
if (!CONTROL_PLANE_TOKEN) {
    console.error('[Server] ERROR: CONTROL_PLANE_TOKEN environment variable is required.');
    console.error('[Server] Example:  CONTROL_PLANE_TOKEN=my-secret-token node headless/index.js');
    process.exit(1);
}

// ── Set FB_DATA_DIR BEFORE requiring any desktop service ──────────────────────
// database.js and playwright-manager.js both check this env var.
if (!process.env.FB_DATA_DIR) {
    process.env.FB_DATA_DIR = path.join(os.homedir(), '.fb-ids-messenger');
}
const DATA_DIR = process.env.FB_DATA_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true });

console.log('[Server] ─────────────────────────────────────────────');
console.log('[Server] FB IDs Messenger — Headless Server');
console.log('[Server] Data directory :', DATA_DIR);
console.log('[Server] API port       :', process.env.CONTROL_PLANE_PORT || 3847);
console.log('[Server] ─────────────────────────────────────────────');

// ── Services (all Electron-free after the patches to database.js / playwright-manager.js) ──
const Database          = require('../desktop/db/database');
const PlaywrightManager = require('../desktop/services/playwright-manager');
const MessageMonitor    = require('../desktop/services/message-monitor');
const ReplyService      = require('../desktop/services/reply-service');
const PollScheduler     = require('../desktop/services/poll-scheduler');
const NotificationOutbox = require('../desktop/services/notification-outbox');
const NotificationSender = require('../desktop/services/notification-sender');
const SessionMonitor    = require('../desktop/services/session-monitor');
const controlPlane      = require('../control-plane');

// ── Database ──────────────────────────────────────────────────────────────────
Database.initDatabase();
console.log('[Server] Database ready');

// ── Notification pipeline (Expo Push primary; Telegram skipped in headless) ───
NotificationSender.init({ store: null }); // store=null → telegram_fallback disabled
NotificationOutbox.setSender((notifData, context) => NotificationSender.send(notifData, context));
NotificationOutbox.start();

// ── Account session launcher ──────────────────────────────────────────────────
const LAUNCH_BATCH_SIZE     = 5;
const LAUNCH_BATCH_DELAY_MS = 2000;

async function restoreAccount(acc) {
    console.log(`[Server] Restoring session: ${acc.id}`);
    try {
        await PlaywrightManager.launchAccount(acc.id, true /* headless */);
        const page = await PlaywrightManager.getMessengerPage(acc.id);
        await MessageMonitor.attach(page, acc.id);

        const identity = await PlaywrightManager.extractFbIdentity(acc.id);
        const db = Database.getDb();
        if (identity && (identity.fbName || identity.fbUserId)) {
            db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('active', acc.id);
            if (identity.fbName)   db.prepare('UPDATE accounts SET fb_name = ? WHERE id = ?').run(identity.fbName, acc.id);
            if (identity.fbUserId) db.prepare('UPDATE accounts SET fb_user_id = ? WHERE id = ?').run(identity.fbUserId, acc.id);
            console.log(`[Server] Account ${acc.id} is active`);
        } else {
            db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run('needs_login', acc.id);
            console.warn(`[Server] Account ${acc.id} has no active Facebook session — needs login via desktop app`);
        }
    } catch (err) {
        console.error(`[Server] Failed to restore ${acc.id}:`, err.message);
        Database.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('offline', acc.id);
    }
}

async function start() {
    const accounts = Database.getDb().prepare('SELECT * FROM accounts').all();
    console.log(`[Server] Found ${accounts.length} account(s)`);

    for (let i = 0; i < accounts.length; i += LAUNCH_BATCH_SIZE) {
        const batch = accounts.slice(i, i + LAUNCH_BATCH_SIZE);
        const batchNum = Math.floor(i / LAUNCH_BATCH_SIZE) + 1;
        console.log(`[Server] Launching batch ${batchNum}: accounts ${i + 1}–${Math.min(i + LAUNCH_BATCH_SIZE, accounts.length)}`);
        await Promise.all(batch.map(restoreAccount));
        if (i + LAUNCH_BATCH_SIZE < accounts.length) {
            await new Promise(r => setTimeout(r, LAUNCH_BATCH_DELAY_MS));
        }
    }

    // Recover any replies that were in-flight when the process last stopped
    await ReplyService.recoverPendingReplies();

    // Start centralised Playwright poll scheduler
    PollScheduler.start();

    // Session health monitor (checks for expired logins every 8 min)
    const sessionMonitor = new SessionMonitor(PlaywrightManager, Database, null /* no telegram */);
    sessionMonitor.start();

    // ── Control-plane HTTP server ─────────────────────────────────────────
    const port = Number(process.env.CONTROL_PLANE_PORT || 3847);

    controlPlane.startHttpServer({
        port,
        token: CONTROL_PLANE_TOKEN,
        getDb: () => Database.getDb(),
        queueReplyFromCommand: (opts) => ReplyService.queueReplyFromCommand(opts),
        syncConversation: async (accountId, conversationId) => {
            try {
                const messages = await PlaywrightManager.fetchHistory(accountId, conversationId);
                const db = Database.getDb();
                const tx = db.transaction((msgs) => {
                    for (const m of msgs) {
                        const id = `msg_sync_${conversationId}_${m.timestamp}_${Math.random().toString(36).slice(2, 6)}`;
                        db.prepare(`
                            INSERT OR IGNORE INTO messages
                                (id, conversation_id, account_id, sender_name, body, timestamp, is_outgoing)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `).run(id, conversationId, accountId, m.senderName, m.body, m.timestamp, m.isOutgoing ? 1 : 0);
                    }
                });
                tx(messages);
                return { ok: true, count: messages.length };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        },
    });

    console.log('[Server] ─────────────────────────────────────────────');
    console.log(`[Server] Control-plane API listening on port ${port}`);
    console.log(`[Server] Health check: http://localhost:${port}/health`);
    console.log('[Server] All systems go. Ready for mobile connections.');
    console.log('[Server] ─────────────────────────────────────────────');
}

start().catch((err) => {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
    console.log(`[Server] ${signal} received — shutting down gracefully...`);
    try {
        PollScheduler.stop();
        NotificationOutbox.stop();
        await PlaywrightManager.closeAll();
    } catch (e) {
        console.error('[Server] Shutdown error:', e.message);
    }
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
