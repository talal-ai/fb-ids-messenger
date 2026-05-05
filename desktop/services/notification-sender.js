/**
 * Notification Sender — adapter for NotificationOutbox.
 *
 * Primary:  Expo Push (mobile app)
 * Fallback: Telegram bot (if telegram_fallback_enabled setting is true)
 *
 * Wired into NotificationOutbox.setSender() in main.js.
 *
 * Receipt-driven token GC:
 *   3s after every successful send, we poll the receipts. On DeviceNotRegistered,
 *   the corresponding row in device_tokens is deleted so the next push doesn't
 *   waste a network call. Other errors are logged but kept (could be transient).
 */

const { sendExpoPush, getExpoPushReceipts } = require('./expo-push');
const Database = require('../db/database');

const RECEIPT_POLL_DELAY_MS = 3_000;

let _telegramSender = null;
let _store = null;

function init(deps) {
    if (deps.telegramSender) _telegramSender = deps.telegramSender;
    if (deps.store) _store = deps.store;
}

function deleteDeadToken(token) {
    try {
        const db = Database.getDb();
        const r = db.prepare('DELETE FROM device_tokens WHERE token = ?').run(token);
        if (r.changes > 0) {
            console.warn(`[NotifSender] Removed dead token (DeviceNotRegistered): ${token.slice(0, 24)}...`);
        }
    } catch (err) {
        console.error('[NotifSender] Failed to delete dead token:', err.message);
    }
}

/**
 * Schedule a receipt poll for a set of tickets emitted by sendExpoPush.
 * Logs each non-ok receipt with full FCM error details. Deletes dead tokens.
 */
function scheduleReceiptPoll(tickets) {
    const trackable = (tickets || []).filter((t) => t.ticket && t.ticket.status === 'ok' && t.ticket.id);
    if (trackable.length === 0) {
        // Log inline ticket errors (rejected at queue time, never get a receipt)
        for (const t of (tickets || [])) {
            if (t.ticket && t.ticket.status === 'error') {
                console.error(
                    `[NotifSender] Ticket error for ${t.token.slice(0, 24)}...: ${t.ticket.message || ''} ${JSON.stringify(t.ticket.details || {})}`
                );
                if (t.ticket.details && t.ticket.details.error === 'DeviceNotRegistered') {
                    deleteDeadToken(t.token);
                }
            }
        }
        return;
    }

    const idToToken = new Map(trackable.map((t) => [t.ticket.id, t.token]));

    setTimeout(async () => {
        try {
            const { ok, receipts, error } = await getExpoPushReceipts([...idToToken.keys()]);
            if (!ok) {
                console.error(`[NotifSender] Receipt poll failed: ${error}`);
                return;
            }
            for (const [ticketId, token] of idToToken) {
                const r = receipts[ticketId];
                if (!r) continue; // still pending on Expo's side
                if (r.status === 'ok') continue;

                const errCode = (r.details && r.details.error) || 'unknown';
                console.error(
                    `[NotifSender] Receipt error [${errCode}] for ${token.slice(0, 24)}...: ${r.message || ''}`
                );

                if (errCode === 'DeviceNotRegistered') {
                    deleteDeadToken(token);
                }
                // Other errors (MessageRateExceeded, MismatchSenderId, MessageTooBig,
                // InvalidCredentials) are logged but the token is kept — these are
                // sender-side problems, not token-side.
            }
        } catch (err) {
            console.error('[NotifSender] Receipt poll exception:', err.message);
        }
    }, RECEIPT_POLL_DELAY_MS);
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
                channelId: 'default',
                priority: 'high',
                data: {
                    accountId,
                    conversationId,
                    senderName,
                    timestamp,
                },
            });
            expoPushOk = result.ok;
            if (result.ok) {
                console.log(`[NotifSender] Expo push queued for ${tokens.length} device(s)`);
            } else {
                console.warn(
                    `[NotifSender] Expo push failed: ${result.error || JSON.stringify(result.results)}`
                );
            }
            // Always poll receipts — this is where FCM/APNs failures surface.
            scheduleReceiptPoll(result.tickets);
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

    return {
        ok: expoPushOk || !!telegramMsgId,
        telegramMsgId: telegramMsgId || null,
    };
}

module.exports = { init, send };
