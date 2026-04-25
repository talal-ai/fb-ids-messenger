const http = require('http');
const { acceptInboundEvent } = require('../services/inbound-event-service');
const { acceptReplyCommand } = require('../services/reply-command-service');

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (!raw || !raw.trim()) {
                    resolve(null);
                    return;
                }
                resolve(JSON.parse(raw));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function json(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function extractBearer(req) {
    const h = req.headers.authorization || req.headers.Authorization;
    if (!h || typeof h !== 'string') return null;
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
}

/**
 * @param {{ port?: number, token: string, getDb: () => import('better-sqlite3').Database, queueReplyFromCommand: (o: Record<string, unknown>) => Promise<Record<string, unknown>> }} opts
 * @returns {import('http').Server}
 */
function startHttpServer(opts) {
    const port = opts.port || 3847;
    const token = opts.token;
    const getDb = opts.getDb;
    const queueReplyFromCommand = opts.queueReplyFromCommand;

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const path = url.pathname;

            console.log(`[ControlPlane] ${req.method} ${path}`);

            // ── Health (unauthenticated) ─────────────────────────────────
            if (req.method === 'GET' && path === '/health') {
                json(res, 200, { ok: true, service: 'control-plane' });
                return;
            }

            // ── Auth ─────────────────────────────────────────────────────
            const bearer = extractBearer(req);
            if (!token || bearer !== token) {
                json(res, 401, { ok: false, code: 'unauthorized' });
                return;
            }

            // ── GET /v1/accounts ─────────────────────────────────────────
            if (req.method === 'GET' && path === '/v1/accounts') {
                const rows = getDb().prepare(
                    'SELECT id, nickname, fb_name, fb_user_id, status, created_at FROM accounts ORDER BY created_at DESC'
                ).all();
                json(res, 200, { ok: true, accounts: rows });
                return;
            }

            // ── GET /v1/conversations ────────────────────────────────────
            if (req.method === 'GET' && path === '/v1/conversations') {
                const accountId = url.searchParams.get('account_id');
                const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
                const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;

                let query = `
                    SELECT c.id, c.account_id,
                           COALESCE(c.participant_name, (
                               SELECT sender_name FROM messages
                               WHERE conversation_id = c.id AND is_outgoing = 0
                               ORDER BY timestamp DESC LIMIT 1
                           )) AS participant_name,
                           c.last_message, c.last_message_at, c.unread_count,
                           COALESCE(NULLIF(TRIM(a.nickname), ''), NULLIF(TRIM(a.fb_name), ''), 'Default Profile') AS account_label,
                           a.fb_user_id AS account_fb_user_id
                    FROM conversations c
                    LEFT JOIN accounts a ON c.account_id = a.id
                `;
                const params = [];
                if (accountId) {
                    query += ' WHERE c.account_id = ?';
                    params.push(accountId);
                }
                query += ' ORDER BY c.last_message_at DESC LIMIT ? OFFSET ?';
                params.push(limit, offset);

                const rows = getDb().prepare(query).all(...params);
                json(res, 200, { ok: true, conversations: rows });
                return;
            }

            // ── GET /v1/conversations/:id/messages ───────────────────────
            const msgMatch = path.match(/^\/v1\/conversations\/(.+)\/messages$/);
            if (req.method === 'GET' && msgMatch) {
                const conversationId = decodeURIComponent(msgMatch[1]);
                const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
                const before = parseInt(url.searchParams.get('before') || '0', 10) || 0;

                // Known junk strings scraped from Facebook's UI (sidebar nav items,
                // accessibility labels, system notices). Delete them from DB and exclude.
                const JUNK_BODIES = [
                    'Privacy & support', 'Media and files', 'Customise chat', 'Chat info',
                    'Notifications', 'Search in conversation', 'View profile', 'Block',
                    'Something went wrong', 'You are now connected on Messenger',
                    'Say hi to your new Facebook friend', 'You sent', 'Message sent',
                    'Enter, Message sent', 'Enter',
                ];
                // Purge any already-stored junk rows for this conversation
                try {
                    const db = getDb();
                    for (const junk of JUNK_BODIES) {
                        db.prepare(
                            `DELETE FROM messages WHERE conversation_id = ? AND body = ? AND is_outgoing = 0`
                        ).run(conversationId, junk);
                    }
                    // Also purge messages matching accessibility patterns (e.g. "Enter, Message sent Today at…")
                    db.prepare(
                        `DELETE FROM messages WHERE conversation_id = ? AND (
                            body LIKE 'Enter, Message sent%'
                            OR body LIKE 'Message sent today%'
                            OR body LIKE 'Message sent yesterday%'
                            OR body LIKE 'Tap to retry%'
                        ) AND is_outgoing = 0`
                    ).run(conversationId);
                } catch { /* non-fatal */ }

                let query = `SELECT id, conversation_id, account_id, sender_name, body, timestamp, is_outgoing
                             FROM messages
                             WHERE conversation_id = ?
                               AND body IS NOT NULL
                               AND TRIM(body) != ''
                               AND body NOT IN (${JUNK_BODIES.map(() => '?').join(',')})
                               AND body NOT LIKE 'Enter, Message sent%'
                               AND body NOT LIKE 'Message sent today%'
                               AND body NOT LIKE 'Message sent yesterday%'`;
                const params = [conversationId, ...JUNK_BODIES];
                if (before > 0) {
                    query += ' AND timestamp < ?';
                    params.push(before);
                }
                query += ' ORDER BY timestamp DESC LIMIT ?';
                params.push(limit);

                const rows = getDb().prepare(query).all(...params);
                json(res, 200, { ok: true, messages: rows });
                return;
            }

            // ── POST /v1/device-tokens ───────────────────────────────────
            if (req.method === 'POST' && path === '/v1/device-tokens') {
                const body = await readJsonBody(req);
                if (!body || !body.token) {
                    json(res, 400, { ok: false, code: 'validation_error', detail: 'token required' });
                    return;
                }
                const now = Date.now();
                getDb().prepare(`
                    INSERT INTO device_tokens (token, platform, label, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(token) DO UPDATE SET platform = excluded.platform, label = excluded.label, updated_at = excluded.updated_at
                `).run(body.token, body.platform || 'ios', body.label || null, now, now);
                json(res, 200, { ok: true });
                return;
            }

            // ── POST /v1/conversations/:id/mark-read ─────────────────────
            const markReadMatch = path.match(/^\/v1\/conversations\/(.+)\/mark-read$/);
            if (req.method === 'POST' && markReadMatch) {
                const conversationId = decodeURIComponent(markReadMatch[1]);
                getDb().prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(conversationId);
                json(res, 200, { ok: true });
                return;
            }

            // ── POST /v1/conversations/:id/sync ─────────────────────
            const syncMatch = path.match(/^\/v1\/conversations\/(.+)\/sync$/);
            if (req.method === 'POST' && syncMatch) {
                const conversationId = decodeURIComponent(syncMatch[1]);
                const body = await readJsonBody(req);
                const accountId = body?.account_id;
                
                if (!accountId) {
                    json(res, 400, { ok: false, code: 'validation_error', detail: 'account_id required' });
                    return;
                }

                if (typeof opts.syncConversation !== 'function') {
                    json(res, 501, { ok: false, code: 'not_implemented' });
                    return;
                }

                const result = await opts.syncConversation(accountId, conversationId);
                json(res, result.ok ? 200 : 500, result);
                return;
            }

            // ── POST /v1/inbound-events ──────────────────────────────────
            if (req.method === 'POST' && path === '/v1/inbound-events') {
                const body = await readJsonBody(req);
                const result = acceptInboundEvent(getDb(), body);
                json(res, result.ok ? 200 : 400, result);
                return;
            }

            // ── POST /v1/reply-commands ──────────────────────────────────
            if (req.method === 'POST' && path === '/v1/reply-commands') {
                const body = await readJsonBody(req);

                // ─────────────────────────────────────────────────────────
                // STEP 1: Pre-persist the outgoing message to the DB
                // immediately — BEFORE handing off to Playwright.
                //
                // Root cause of "vanishing replies":
                //   acceptReplyCommand resolves only AFTER Playwright finishes
                //   (~10-30s). If Playwright fails (browser closed, account
                //   offline, etc.), result.ok = false and the message was
                //   never saved. Now we save it up-front so it's always in
                //   the history regardless of execution outcome.
                // ─────────────────────────────────────────────────────────
                if (body && body.reply_id && body.conversation_id && body.account_id && body.message_raw) {
                    const now = Date.now();
                    const ts = (typeof body.created_at === 'number' && body.created_at > 0)
                        ? body.created_at : now;
                    try {
                        const db = getDb();

                        // Ensure the conversation row exists (FK constraint).
                        const convExists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(body.conversation_id);
                        if (!convExists) {
                            db.prepare(
                                `INSERT OR IGNORE INTO conversations (id, account_id, last_message, last_message_at, unread_count)
                                 VALUES (?, ?, ?, ?, 0)`
                            ).run(body.conversation_id, body.account_id, body.message_raw, ts);
                            console.log(`[ControlPlane] Created placeholder conversation: ${body.conversation_id}`);
                        }

                        // Persist outgoing message — INSERT OR IGNORE is safe for retries/duplicates.
                        const ins = db.prepare(
                            `INSERT OR IGNORE INTO messages
                                 (id, conversation_id, account_id, sender_name, body, timestamp, is_outgoing)
                             VALUES (?, ?, ?, 'You', ?, ?, 1)`
                        ).run(body.reply_id, body.conversation_id, body.account_id, body.message_raw, ts);

                        if (ins.changes > 0) {
                            console.log(`[ControlPlane] Pre-saved reply ${body.reply_id} to DB (before Playwright execution)`);
                        }

                        // Update inbox preview.
                        db.prepare(
                            `UPDATE conversations SET last_message = ?, last_message_at = ? WHERE id = ?`
                        ).run(body.message_raw, ts, body.conversation_id);

                    } catch (preErr) {
                        // Log but don't abort — the message might still send even if DB write fails.
                        console.error('[ControlPlane] Pre-persist error:', preErr && preErr.message);
                    }
                }

                // STEP 2: Queue the reply for Playwright execution (async, may take 10-30s).
                const result = await acceptReplyCommand(getDb(), body, queueReplyFromCommand);
                const status = result.ok ? 200 : result.code === 'idempotency_conflict' ? 409 : 400;

                json(res, status, result);
                return;
            }

            json(res, 404, { ok: false, code: 'not_found' });
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            json(res, 400, { ok: false, code: 'bad_request', detail: msg });
        }
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`[ControlPlane] HTTP listening on http://0.0.0.0:${port}`);
    });

    return server;
}

module.exports = { startHttpServer };
