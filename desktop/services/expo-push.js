/**
 * Expo Push Notification sender + receipt poller.
 *
 * Pure HTTPS — no SDK dependency.
 *
 * Two-step delivery model on Expo:
 *   1. POST /push/send       → returns "tickets". status:"ok" means QUEUED, not delivered.
 *   2. POST /push/getReceipts → returns "receipts". status:"ok" means FCM/APNs ACCEPTED.
 *
 * Android failures (missing FCM V1 credential, MismatchSenderId, DeviceNotRegistered)
 * appear ONLY in the receipt — never in the ticket. So we always poll receipts.
 */

const https = require('https');

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const TIMEOUT_MS = 10_000;

function postJson(url, body) {
    const payload = JSON.stringify(body);
    return new Promise((resolve) => {
        const u = new URL(url);
        const req = https.request(
            {
                hostname: u.hostname,
                path: u.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'Accept': 'application/json',
                },
                timeout: TIMEOUT_MS,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    try {
                        const raw = Buffer.concat(chunks).toString('utf8');
                        resolve({ ok: true, status: res.statusCode, json: JSON.parse(raw) });
                    } catch (e) {
                        resolve({ ok: false, error: `parse-error: ${e.message}` });
                    }
                });
            }
        );
        req.on('error', (e) => resolve({ ok: false, error: `network-error: ${e.message}` }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, error: 'timeout' });
        });
        req.write(payload);
        req.end();
    });
}

/**
 * Send a push to one or more Expo push tokens.
 *
 * @param {string|string[]} tokens
 * @param {{ title: string, body: string, sound?: string, data?: object, channelId?: string, priority?: 'default'|'normal'|'high' }} payload
 * @returns {Promise<{ ok: boolean, results?: object[], tickets?: Array<{ token: string, ticket: object }>, error?: string }>}
 *   tickets[i] pairs each input token with the ticket Expo returned, so the caller
 *   can map a later DeviceNotRegistered receipt back to the token to delete.
 */
async function sendExpoPush(tokens, payload) {
    const tokenArr = Array.isArray(tokens) ? tokens : [tokens];
    if (tokenArr.length === 0) {
        return { ok: false, error: 'no-tokens' };
    }

    const messages = tokenArr.map((token) => ({
        to: token,
        title: payload.title || '',
        body: payload.body || '',
        sound: payload.sound || 'default',
        channelId: payload.channelId || 'default',
        priority: payload.priority || 'high',
        data: payload.data || {},
    }));

    const res = await postJson(EXPO_SEND_URL, messages);
    if (!res.ok) {
        return { ok: false, error: res.error };
    }

    const results = (res.json && res.json.data) || [];
    const tickets = tokenArr.map((token, i) => ({ token, ticket: results[i] || null }));
    const anyOk = results.some((r) => r && r.status === 'ok');

    return { ok: anyOk, results, tickets };
}

/**
 * Fetch receipts for an array of ticket IDs.
 *
 * @param {string[]} ticketIds
 * @returns {Promise<{ ok: boolean, receipts?: Record<string, object>, error?: string }>}
 *   receipts is a map ticketId -> { status, message?, details? }.
 *   Missing receipts (still pending on Expo's side) won't appear in the map.
 */
async function getExpoPushReceipts(ticketIds) {
    const ids = (ticketIds || []).filter(Boolean);
    if (ids.length === 0) return { ok: true, receipts: {} };

    const res = await postJson(EXPO_RECEIPTS_URL, { ids });
    if (!res.ok) return { ok: false, error: res.error };

    return { ok: true, receipts: (res.json && res.json.data) || {} };
}

module.exports = { sendExpoPush, getExpoPushReceipts };
