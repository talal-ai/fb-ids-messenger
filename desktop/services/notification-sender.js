/**
 * Notification Sender — adapter for NotificationOutbox.
 *
 * Primary:  Expo Push (mobile app)
 * Fallback: Telegram bot (if telegram_fallback_enabled setting is true)
 *
 * This module is wired into NotificationOutbox.setSender() in main.js.
 */

const { sendExpoPush } = require('./expo-push');
const Database = require('../db/database');

let _telegramSender = null;
let _store = null;

/**
 * Inject optional dependencies.
 * @param {{ telegramSender?: Function, store?: import('electron-store') }} deps
 */
function init(deps) {
    if (deps.telegramSender) _telegramSender = deps.telegramSender;
    if (deps.store) _store = deps.store;
}

/**
 * Send a notification via Expo Push (primary) and optionally Telegram (fallback).
 *
 * @param {{ senderName: string, body: string, accountId: string, accountLabel: string, timestamp: number }} notifData
 * @param {{ accountId: string, conversationId: string, senderName: string, accountLabel: string }|null} context
 * @returns {Promise<{ ok: boolean, telegramMsgId?: number }>}
 */
async function send(notifData, context) {
    const { senderName, body, accountId, accountLabel, timestamp } = notifData;
    const conversationId = context ? context.conversationId : null;

    // ── Expo Push (primary) ──────────────────────────────────────────────
    let expoPushOk = false;
    try {
        const db = Database.getDb();
        const tokens = db.prepare('SELECT token FROM device_tokens').all().map((r) => r.token);

        if (tokens.length > 0) {
            const result = await sendExpoPush(tokens, {
                title: accountLabel || accountId,
                body: `${senderName}: ${body}`,
                sound: 'default',
                data: {
                    accountId,
                    conversationId,
                    senderName,
                    timestamp,
                },
            });
            expoPushOk = result.ok;
            if (result.ok) {
                console.log(`[NotifSender] Expo push sent to ${tokens.length} device(s)`);
            } else {
                console.warn(`[NotifSender] Expo push failed: ${result.error || JSON.stringify(result.results)}`);
            }
        } else {
            console.log('[NotifSender] No device tokens registered — skipping Expo push');
        }
    } catch (err) {
        console.error('[NotifSender] Expo push error:', err.message);
    }

    // ── Telegram fallback ────────────────────────────────────────────────
    let telegramMsgId = null;
    const telegramFallback = _store && _store.get('telegram_fallback_enabled') === true;
    if (telegramFallback && _telegramSender) {
        try {
            const result = await _telegramSender(notifData, context);
            telegramMsgId = result && result.telegramMsgId;
            console.log('[NotifSender] Telegram fallback sent');
        } catch (err) {
            console.error('[NotifSender] Telegram fallback error:', err.message);
        }
    }

    // Success if either channel delivered
    return {
        ok: expoPushOk || !!telegramMsgId,
        telegramMsgId: telegramMsgId || null,
    };
}

module.exports = { init, send };
