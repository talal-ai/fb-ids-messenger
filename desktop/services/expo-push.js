/**
 * Expo Push Notification sender.
 *
 * Pure HTTP client — no SDK dependency.
 * POSTs to Expo's public push API (free, no API key required).
 */

const https = require('https');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TIMEOUT_MS = 10_000;

/**
 * Send a push notification to one or more Expo push tokens.
 *
 * @param {string|string[]} tokens  - ExponentPushToken[xxx] or array of tokens
 * @param {{ title: string, body: string, sound?: string, data?: object }} payload
 * @returns {Promise<{ ok: boolean, results?: object[], error?: string }>}
 */
function sendExpoPush(tokens, payload) {
    const tokenArr = Array.isArray(tokens) ? tokens : [tokens];
    if (tokenArr.length === 0) {
        return Promise.resolve({ ok: false, error: 'no-tokens' });
    }

    // Expo supports batching up to 100 notifications per request
    const messages = tokenArr.map((token) => ({
        to: token,
        title: payload.title || '',
        body: payload.body || '',
        sound: payload.sound || 'default',
        data: payload.data || {},
    }));

    const body = JSON.stringify(messages);

    return new Promise((resolve) => {
        const url = new URL(EXPO_PUSH_URL);
        const req = https.request(
            {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
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
                        const json = JSON.parse(raw);
                        // Expo returns { data: [{ id, status }] }
                        const results = json.data || [];
                        const anyOk = results.some((r) => r.status === 'ok');
                        resolve({ ok: anyOk, results });
                    } catch (e) {
                        resolve({ ok: false, error: `parse-error: ${e.message}` });
                    }
                });
            }
        );

        req.on('error', (e) => {
            resolve({ ok: false, error: `network-error: ${e.message}` });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, error: 'timeout' });
        });

        req.write(body);
        req.end();
    });
}

module.exports = { sendExpoPush };
