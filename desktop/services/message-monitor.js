
const Database = require('../db/database');
const PollScheduler = require('./poll-scheduler');
const crypto = require('crypto');
const NotificationOutbox = require('./notification-outbox');

// ─────────────────────────────────────────────────────────────────────────────
// Dedup: ignore same sender+body within 30 s sliding window
// ─────────────────────────────────────────────────────────────────────────────
const DEDUP_MS = 30_000;
const PENDING_TELEGRAM_TTL_MS = 60_000;  // 60s — enough for a slow PollScheduler cycle with 30+ accounts
const NETWORK_RESPONSE_MAX_BYTES = 512 * 1024; // 512 KB — skip large GraphQL payloads (history loads etc.)
const recentHashes = new Map();

function isDuplicate(sender, body, accountId) {
    // Key is scoped per-account so same message on different accounts are never suppressed
    const k = `${accountId || ''}|${(sender || '').toLowerCase().trim()}|${(body || '').substring(0, 80).toLowerCase().trim()}`;
    const now = Date.now();
    const lastSeen = recentHashes.get(k);
    if (lastSeen && (now - lastSeen) < DEDUP_MS) return true;
    recentHashes.set(k, now);
    // Cleanup entries older than 60s
    const cutoff = now - 60_000;
    for (const [key, ts] of recentHashes) if (ts < cutoff) recentHashes.delete(key);
    // Hard cap to prevent unbounded growth
    if (recentHashes.size > 5000) {
        const oldest = recentHashes.keys().next().value;
        recentHashes.delete(oldest);
    }
    return false;
}

/** Build a stable key for pending Telegram entries (one per logical message per account). */
function pendingKey(accountId, senderName, body) {
    const s = (senderName || '').trim().toLowerCase();
    const b = (body || '').substring(0, 80).trim().toLowerCase();
    return `${accountId}|${s}|${b}`;
}

/** Check if body matches preview (exact or substring after normalize). Prefer unread when multiple match. */
function sidebarMatchPreview(body, entry) {
    if (!entry || !entry.preview) return false;
    const a = (body || '').trim().toLowerCase();
    const p = (entry.preview || '').trim().toLowerCase();
    return a === p || p.includes(a) || a.includes(p);
}

function isValidBody(text) {
    if (!text || text.length < 1) return false;  // allow single-char messages like "K", "k", "Y"
    if (/^[\s\u00b7\u2022.\u2026\-]+$/.test(text)) return false;
    return true;
}

// Detects outgoing-message sidebar previews that Facebook shows while/after we send.
// These must NEVER trigger an incoming notification.
function isOutgoingPreview(text) {
    if (!text) return false;
    const t = text.trim().toLowerCase();
    // Facebook's own sending indicator
    if (t === 'sending...' || t === 'sending') return true;
    // "You: <message>" prefix — our outgoing message in the sidebar
    if (t.startsWith('you:') || t.startsWith('you ')) return true;
    return false;
}

/**
 * Build a deterministic event key so multiple detection strategies
 * (sidebar/network/notification) collapse to one logical inbound event.
 */
function buildEventKey(accountId, conversationId, senderName, body, ts) {
    const conv = conversationId || 'unknown';
    const sender = (senderName || '').trim().toLowerCase();
    const msg = (body || '').trim().toLowerCase();
    // 5s time bucket balances cross-strategy dedup without suppressing true repeats.
    const bucket = Math.floor((ts || Date.now()) / 5000);
    const raw = `${accountId}|${conv}|${sender}|${msg}|${bucket}`;
    return crypto.createHash('sha1').update(raw).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-page script: intercepts Notification API only.
// Everything else runs from Node.js via page.evaluate() polling.
// ─────────────────────────────────────────────────────────────────────────────
const NOTIFICATION_INTERCEPT = `(function() {
    if (window.__fbNotifHooked) return;
    window.__fbNotifHooked = true;
    try {
        const Orig = window.Notification;
        window.Notification = function(title, opts) {
            const body = (opts && opts.body) || '';
            if (title && body && window.__fbMsgNotify) {
                window.__fbMsgNotify({
                    senderName: title,
                    body: body,
                    detectedBy: 'notification-api',
                    timestamp: Date.now()
                });
            }
            try { return new Orig(title, opts); } catch(e) { return {}; }
        };
        window.Notification.permission = 'granted';
        window.Notification.requestPermission = () => Promise.resolve('granted');
        if (navigator.permissions && navigator.permissions.query) {
            const origQ = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = function(desc) {
                if (desc && desc.name === 'notifications')
                    return Promise.resolve({ state: 'granted', onchange: null });
                return origQ(desc);
            };
        }
    } catch(e) {}
})();`;

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar extraction — executed via page.evaluate() from Node.js.
// Returns plain data object; no callbacks or long-lived observers.
// ─────────────────────────────────────────────────────────────────────────────
const SIDEBAR_EXTRACT_FN = `(() => {
    const result = { title: document.title, url: location.href, chats: [] };

    // Strategy A: conversation links (both URL patterns)
    // - /messages/t/<id>     → Marketplace, some groups, non-e2ee threads
    // - /messages/e2ee/t/<id> → regular DMs (end-to-end encrypted)
    const links = document.querySelectorAll(
        'a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]'
    );

    // Helper: returns true if text is just a separator/dot/trivial
    function isSeparator(t) {
        if (!t) return true;
        // Single char separators: · • … . - or pure whitespace
        if (/^[\\s\\u00b7\\u2022\\u2026.\\-:,|]+$/.test(t)) return true;
        // Time-only labels
        if (/^(\\d+\\s?[smhdwmy]|yesterday|today|just now|\\d{1,2}:\\d{2}\\s?(am|pm)?)$/i.test(t)) return true;
        return false;
    }

    for (const link of links) {
        try {
            const href = link.getAttribute('href') || '';
            const m = href.match(/\\/messages\\/(?:e2ee\\/)?t\\/(\\d+)/);
            if (!m) continue;
            const convId = m[1];

            const spans = link.querySelectorAll('[dir="auto"]');
            const senderName = spans[0] ? spans[0].textContent.trim() : '';

            // Message preview: walk ALL spans (skip sender at index 0), collect non-separator text.
            // Take the longest non-separator text as the preview (most likely the actual message).
            let preview = '';
            let candidates = [];
            for (let i = 1; i < spans.length; i++) {
                const t = (spans[i].textContent || '').trim();
                if (t && !isSeparator(t)) {
                    candidates.push(t);
                }
            }
            // Prefer the last (bottom-most) non-separator span, which is typically the message preview.
            // If that's too short, fall back to the longest candidate.
            if (candidates.length > 0) {
                preview = candidates[candidates.length - 1];
                // If the last candidate is very short (< 3 chars) and there's a longer one, use the longest
                if (preview.length < 3) {
                    const longest = candidates.reduce((a, b) => a.length >= b.length ? a : b, '');
                    if (longest.length > preview.length) preview = longest;
                }
            }

            // Fallback: also check innerText of the row itself
            if (!preview) {
                const row = link.closest('[role="row"], [role="listitem"]') || link;
                const allText = row.innerText || '';
                const lines = allText.split('\\n').map(l => l.trim()).filter(l => l && !isSeparator(l));
                // Skip the first line (sender name), take the rest
                for (let i = lines.length - 1; i >= 1; i--) {
                    if (lines[i] !== senderName && lines[i].length >= 2) {
                        preview = lines[i];
                        break;
                    }
                }
            }

            // Unread: bold font-weight, badge dot, or aria label
            let isUnread = false;
            if (spans[0]) {
                const fw = parseInt(window.getComputedStyle(spans[0]).fontWeight);
                if (fw >= 600) isUnread = true;
            }
            const row = link.closest('[role="row"], [role="listitem"]') || link;
            if (row.querySelector('[data-testid="badge"]') ||
                row.querySelector('[aria-label*="unread" i]') ||
                link.querySelector('[data-testid="badge"]') ||
                link.querySelector('[aria-label*="unread" i]')) {
                isUnread = true;
            }
            // Also check background color difference (Facebook sometimes highlights unread rows)
            if (!isUnread && row) {
                const bg = window.getComputedStyle(row).backgroundColor;
                // Non-default backgrounds often indicate unread
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(255, 255, 255)') {
                    // Don't auto-set, but it's a weak signal
                }
            }

            if (senderName) {
                result.chats.push({ convId, senderName, preview, isUnread });
            }
        } catch (_) {}
    }
    return result;
})()`;

const INITIAL_DELAY_MS = 6_000;   // let the page render before first poll

class MessageMonitor {
    constructor() {
        this.accounts = new Map(); // accountId → state object
        this._mainWindow = null;
        this._telegramBot = null;
        // Tracks conversations currently being replied to: "accountId|convId" → true
        // Detection is fully suppressed for these during the send window.
        this._replyLocks = new Set();
        // Notifications we could not send (no conversationId). Key: pendingKey(accountId, senderName, body).
        // Value: { accountId, senderName, body, timestamp, timer }. Timer removes entry after TTL (no send).
        this._pendingTelegram = new Map();
    }

    setMainWindow(win) { this._mainWindow = win; }
    setTelegramBot(bot) { this._telegramBot = bot; }

    /** Remove a pending Telegram entry and cancel its TTL timer. */
    _removePending(key) {
        const entry = this._pendingTelegram.get(key);
        if (entry && entry.timer) clearTimeout(entry.timer);
        this._pendingTelegram.delete(key);
    }

    /** Clean up so attach() can be called again after context swap. */
    detach(accountId) {
        const state = this.accounts.get(accountId);
        if (state) {
            // Cancel the initial-delay timer if it hasn't fired yet
            clearTimeout(state.initialTimer);
            this.accounts.delete(accountId);
        }
        // Remove from central scheduler so no more polls are issued
        PollScheduler.unregister(accountId);
        console.log(`[Monitor] Detached ${accountId}`);
    }

    /**
     * Call this BEFORE navigating to the conversation to send.
     * Fully suppresses detection for this conv while we are sending.
     */
    lockReply(accountId, conversationId) {
        if (!conversationId) return;
        this._replyLocks.add(`${accountId}|${conversationId}`);
        console.log(`[Monitor] lockReply: ${accountId} / ${conversationId}`);
    }

    /**
     * Call this after a reply is sent to a conversation.
     * Releases the lock and stores sent text to skip our own reply preview.
     */
    markReplied(accountId, conversationId, sentText) {
        // Release navigation lock
        this._replyLocks.delete(`${accountId}|${conversationId}`);

        const state = this.accounts.get(accountId);
        if (!state || !conversationId) return;
        const prev = state.sidebarState.get(conversationId);
        state.sidebarState.set(conversationId, {
            preview: prev ? prev.preview : '',
            isUnread: false,
            lastSentReply: (sentText || '').trim().toLowerCase(),
            senderName: prev ? prev.senderName : undefined,
        });
        console.log(`[Monitor] markReplied: ${accountId} / ${conversationId}`);
    }

    /**
     * Capture current sidebar state for this account so the monitor can reconcile
     * messages that arrived during the reply navigation gap. Call before navigating
     * to the conversation to send a reply.
     */
    captureReplySnapshot(accountId) {
        const state = this.accounts.get(accountId);
        if (state) state._replySnapshot = new Map(state.sidebarState);
    }

    /**
     * Attach 3-strategy detection to a Playwright page.
     *
     * Strategy 1 — Node.js-side sidebar polling via page.evaluate()
     * Strategy 2 — Network response interception for GraphQL payloads
     * Strategy 3 — In-page Notification API intercept (backup)
     */
    async attach(page, accountId) {
        if (this.accounts.has(accountId)) return;

        const state = {
            page,
            sidebarState: new Map(),
            lastTitleCount: -1,
            seeded: false,
            initialTimer: null,
            _pollCount: 0,
        };
        this.accounts.set(accountId, state);

        console.log(`[Monitor] Attaching 3-strategy detection to ${accountId}`);

        // ── Strategy 3: Notification API intercept ───────────────────────────
        try {
            await page.exposeFunction('__fbMsgNotify', (data) => {
                this._handleDetected(accountId, data);
            });
        } catch (e) {
            if (!e.message.includes('already')) {
                console.error(`[Monitor] exposeFunction error: ${e.message}`);
            }
        }
        try {
            await page.addInitScript(NOTIFICATION_INTERCEPT);
            await page.evaluate(NOTIFICATION_INTERCEPT);
        } catch (_) {}

        page.on('load', async () => {
            try { await page.evaluate(NOTIFICATION_INTERCEPT); } catch (_) {}
        });

        // ── Strategy 2: Network interception ─────────────────────────────────
        page.on('response', async (response) => {
            try {
                const url = response.url();
                if (!url.includes('/api/graphql') && !url.includes('graphql')) return;
                const ct = response.headers()['content-type'] || '';
                if (!ct.includes('json') && !ct.includes('text')) return;
                // Skip large responses (e.g. full conversation history loads — can be several MB)
                const cl = parseInt(response.headers()['content-length'] || '0', 10);
                if (cl > NETWORK_RESPONSE_MAX_BYTES) return;
                const text = await response.text();
                if (text.length > NETWORK_RESPONSE_MAX_BYTES) return; // double-guard for chunked
                this._parseNetworkPayload(accountId, text);
            } catch (_) {}
        });

        // ── Strategy 1: Node.js-side sidebar + title polling ─────────────────
        // Wait for initial render before first poll, then hand off to PollScheduler.
        // PollScheduler staggers all accounts and caps concurrency at 10.
        state.initialTimer = setTimeout(() => {
            state.initialTimer = null;
            // Perform a single immediate poll to seed sidebar state
            this._pollSidebar(accountId).catch(() => {});
            // Register with central scheduler for all subsequent polls
            PollScheduler.register(accountId, () => this._pollSidebar(accountId));
        }, INITIAL_DELAY_MS);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Strategy 1 — Node.js-driven sidebar poll
    // ═════════════════════════════════════════════════════════════════════════

    async _pollSidebar(accountId) {
        const state = this.accounts.get(accountId);
        if (!state || !state.page) return;

        let data;
        try {
            data = await state.page.evaluate(SIDEBAR_EXTRACT_FN);
        } catch (err) {
            // Page may be navigating or closed — will retry next cycle
            return;
        }

        // If sidebar found 0 chats but the title shows unreads, try scrolling to load chats
        if (data.chats.length === 0 && (data.title || '').match(/^\(\d+\+?\)/)) {
            try {
                // Scroll the sidebar container to trigger lazy-loading
                await state.page.evaluate(`(() => {
                    const sidebar = document.querySelector('[role="navigation"] [role="list"]')
                        || document.querySelector('[aria-label*="Chats"]')
                        || document.querySelector('[role="main"]');
                    if (sidebar) sidebar.scrollTop = 0;
                })()`);
            } catch (_) {}
        }

        // ── Title unread count ──────────────────────────────────────────────
        const titleMatch = (data.title || '').match(/^\((\d+)\+?\)/);
        const titleCount = titleMatch ? parseInt(titleMatch[1]) : 0;
        if (state.seeded && titleCount > (state.lastTitleCount || 0)) {
            console.log(`[Monitor] Title unread ↑ ${state.lastTitleCount} → ${titleCount} (${accountId})`);
        }
        state.lastTitleCount = titleCount;

        // ── Debug: log sidebar on 1st poll, then every 15th (~30 s) ────────
        state._pollCount++;
        if (state._pollCount === 1 || state._pollCount % 15 === 0) {
            console.log(`[Monitor] Poll #${state._pollCount} ${accountId}: url=${data.url}, title="${data.title}", chats=${data.chats.length}`);
            for (const c of data.chats.slice(0, 5)) {
                console.log(`  → ${c.senderName} | "${c.preview}" | unread=${c.isUnread} | id=${c.convId}`);
            }
        }

        // ── Resolve pending Telegram (no-context detections): match by senderName + body/preview ─
        // (Do this before the main loop so we have data.chats to match against; do NOT update
        // sidebarState here — that would make prev === current in the main loop and isNew would never be true.)
        if (this._telegramBot && this._pendingTelegram.size > 0) {
            const db = Database.getDb();
            for (const [key, entry] of [...this._pendingTelegram.entries()]) {
                if (entry.accountId !== accountId) continue;
                const senderNorm = (entry.senderName || '').trim().toLowerCase();
                for (const chat of data.chats) {
                    const chatSenderNorm = (chat.senderName || '').trim().toLowerCase();
                    if (chatSenderNorm !== senderNorm) continue;
                    if (!sidebarMatchPreview(entry.body, { preview: chat.preview })) continue;
                    const ts = entry.timestamp || Date.now();
                    let acc;
                    try {
                        acc = db.prepare('SELECT nickname, fb_name FROM accounts WHERE id = ?').get(accountId);
                    } catch (_) { acc = null; }
                    let label = (acc && (acc.fb_name || acc.nickname)) || accountId;
                    label = label.replace(/^\(\d+\+?\)\s*/, '');
                    const replyCtx = { accountId, conversationId: chat.convId, senderName: entry.senderName, accountLabel: label };
                    NotificationOutbox.enqueue(
                        { senderName: entry.senderName, body: entry.body, accountId, accountLabel: label, timestamp: ts },
                        replyCtx
                    );
                    this._removePending(key);
                    isDuplicate(entry.senderName, entry.body, accountId);
                    break; // one notification per pending entry
                }
            }
        }

        // ── Reconcile after reply: catch messages that arrived during navigation gap ─
        if (state._replySnapshot && state.seeded) {
            for (const chat of data.chats) {
                const snapshot = state._replySnapshot.get(chat.convId);
                if (snapshot && chat.preview !== snapshot.preview && chat.isUnread) {
                    const body = isValidBody(chat.preview) ? chat.preview : null;
                    if (body && !isDuplicate(chat.senderName, body)) {
                        this._handleDetected(accountId, {
                            senderName: chat.senderName,
                            body: body,
                            conversationId: chat.convId,
                            detectedBy: 'sidebar-post-reply-reconcile',
                            timestamp: Date.now(),
                        });
                    }
                }
            }
            state._replySnapshot = null;
        }

        // ── Compare sidebar state ───────────────────────────────────────────
        for (const chat of data.chats) {
            const prev = state.sidebarState.get(chat.convId);
            // Carry forward the last sent reply text (set by markReplied) across polls
            const lastSentReply = (prev && prev.lastSentReply) || '';

            // 1. Skip detection entirely if we are actively sending to this conv
            if (this._replyLocks.has(`${accountId}|${chat.convId}`)) {
                state.sidebarState.set(chat.convId, { preview: chat.preview, isUnread: chat.isUnread, lastSentReply, senderName: chat.senderName });
                continue;
            }

            // 2. Skip if the sidebar preview is an outgoing indicator Facebook shows while/after we send
            //    e.g. "Sending...", "Sending", "You: <text>"
            if (isOutgoingPreview(chat.preview)) {
                state.sidebarState.set(chat.convId, { preview: chat.preview, isUnread: chat.isUnread, lastSentReply, senderName: chat.senderName });
                continue;
            }

            // 3. Skip if the preview exactly matches our last sent reply (brief moment before FB updates)
            const previewNorm = (chat.preview || '').trim().toLowerCase();
            if (lastSentReply && previewNorm === lastSentReply) {
                state.sidebarState.set(chat.convId, { preview: chat.preview, isUnread: chat.isUnread, lastSentReply, senderName: chat.senderName });
                continue;
            }

            // Detect unread messages — only fire notifications AFTER seed scan
            if (chat.isUnread && chat.senderName) {
                const body = isValidBody(chat.preview) ? chat.preview : null;
                // isNew: fires when this is a new conversation, or the preview changed, or
                // it just became unread. Also fires if preview is unchanged but it's been
                // unread for >30s (catches repeat-message case where FB sidebar doesn't refresh).
                const becameUnread = !prev || (!prev.isUnread && chat.isUnread);
                const previewChanged = body && prev && prev.preview !== chat.preview;
                const persistentUnread = chat.isUnread && prev && prev.isUnread &&
                    (Date.now() - (prev.lastUnreadAt || 0)) > 30_000;
                const isNew = !prev || becameUnread || previewChanged || persistentUnread;

                // Seed scan: record state silently, do NOT notify
                if (!state.seeded) {
                    // Will be recorded in sidebarState below
                } else if (isNew && body) {
                    this._handleDetected(accountId, {
                        senderName: chat.senderName,
                        body: body,
                        conversationId: chat.convId,
                        detectedBy: 'sidebar-poll',
                        timestamp: Date.now(),
                    });
                } else if (isNew && !body) {
                    console.log(`[Monitor] Unread from "${chat.senderName}" (${chat.convId}) — preview unavailable: "${chat.preview}"`);
                    this._handleDetected(accountId, {
                        senderName: chat.senderName,
                        body: `(new message from ${chat.senderName})`,
                        conversationId: chat.convId,
                        detectedBy: 'sidebar-poll-no-preview',
                        timestamp: Date.now(),
                    });
                }
            }

            // Preserve lastSentReply and unread tracking across polls
            state.sidebarState.set(chat.convId, {
                preview: chat.preview,
                isUnread: chat.isUnread,
                lastSentReply,
                senderName: chat.senderName,
                lastUnreadAt: chat.isUnread
                    ? ((prev && prev.isUnread) ? (prev.lastUnreadAt || Date.now()) : Date.now())
                    : undefined,
            });
        }

        // First poll is a silent seed
        if (!state.seeded) {
            state.seeded = true;
            console.log(`[Monitor] Seed scan complete for ${accountId} — monitoring active`);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Strategy 2 — Network GraphQL interception
    // ═════════════════════════════════════════════════════════════════════════

    _parseNetworkPayload(accountId, text) {
        try {
            // Facebook sometimes sends newline-delimited JSON
            const lines = text.split('\n').filter(l => l.trim().startsWith('{'));
            for (const line of lines) {
                try { this._walkJSON(accountId, JSON.parse(line), 0); } catch (_) {}
            }
            try { this._walkJSON(accountId, JSON.parse(text), 0); } catch (_) {}
        } catch (_) {}
    }

    _walkJSON(accountId, obj, depth) {
        if (depth > 8 || !obj || typeof obj !== 'object') return;

        // Look for message-shaped objects
        const body = obj.message_text || obj.snippet || obj.text || obj.body;
        const sender = obj.sender_name || obj.author ||
            (obj.message_sender && (obj.message_sender.name || obj.message_sender.id));

        if (body && typeof body === 'string' && sender && typeof sender === 'string') {
            // Filter: must have a timestamp-like field to be a real message
            const hasTimestamp = obj.timestamp || obj.timestamp_ms || obj.timestamp_precise ||
                                obj.sent_time || obj.created_at;
            if (!hasTimestamp) return;

            // Skip overly long content (articles/posts, not chat messages)
            if (body.length > 500) return;

            // Skip system senders
            const senderLower = sender.toLowerCase();
            if (senderLower === 'facebook' || senderLower === 'meta' || senderLower === 'marketplace') return;

            // Handle thread_key being an object {thread_fbid, other_user_id}
            let threadId = obj.thread_key || obj.thread_id || obj.conversation_id || null;
            if (threadId && typeof threadId === 'object') {
                threadId = threadId.thread_fbid || threadId.other_user_id || null;
            }

            this._handleDetected(accountId, {
                senderName: sender,
                body: body,
                conversationId: threadId ? String(threadId) : null,
                detectedBy: 'network-intercept',
                timestamp: Date.now(),
            });
        }

        // Recurse into child objects/arrays
        const values = Array.isArray(obj) ? obj : Object.values(obj);
        for (const val of values) {
            if (val && typeof val === 'object') this._walkJSON(accountId, val, depth + 1);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Shared handler — dedup → DB → renderer → Telegram
    // ═════════════════════════════════════════════════════════════════════════

    _handleDetected(accountId, data) {
        const { senderName, body, conversationId, detectedBy, timestamp } = data;

        if (!senderName || !body) return;
        if (!isValidBody(body)) return;

        // Prefer sidebar over network: if we have a real conversationId and this message was previously
        // added to pending (e.g. network fired first), remove from pending and proceed so we send with context.
        const hasRealConvId = conversationId && !String(conversationId).startsWith('unknown_');
        const key = pendingKey(accountId, senderName, body);
        if (hasRealConvId && this._pendingTelegram.has(key)) {
            this._removePending(key);
            // Fall through — do not treat as duplicate
        } else if (isDuplicate(senderName, body, accountId)) {
            return;
        }

        console.log(`[Monitor][${detectedBy}] "${body}" from "${senderName}" thread=${conversationId} account=${accountId}`);

        const db = Database.getDb();
        const ts = timestamp || Date.now();
        const threadId = conversationId || `unknown_${accountId}_${ts}`;
        const msgId = `msg_${threadId}_${ts}_${Math.random().toString(36).substring(2, 8)}`;

        try {
            const eventKey = buildEventKey(accountId, threadId, senderName, body, ts);

            // Wrap inserts in one transaction. If inbound event already exists,
            // we skip all downstream work for this logical message.
            let inboundEventId = null;
            const insertTx = db.transaction(() => {
                const eventResult = db.prepare(`
                    INSERT OR IGNORE INTO inbound_events
                        (event_key, account_id, conversation_id, sender_name, body, detected_by, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)
                `).run(eventKey, accountId, threadId, senderName, body, detectedBy, ts, Date.now());

                if (eventResult.changes === 0) {
                    return null;
                }
                inboundEventId = Number(eventResult.lastInsertRowid);

                db.prepare(`
                    INSERT INTO conversations (id, account_id, last_message, last_message_at, unread_count)
                    VALUES (?, ?, ?, ?, 1)
                    ON CONFLICT(id) DO UPDATE SET
                        last_message = excluded.last_message,
                        last_message_at = excluded.last_message_at,
                        unread_count = unread_count + 1
                `).run(threadId, accountId, body, ts);

                db.prepare(`
                    INSERT INTO messages (id, conversation_id, account_id, sender_name, body, timestamp, is_outgoing)
                    VALUES (?, ?, ?, ?, ?, ?, 0)
                    ON CONFLICT(id) DO NOTHING
                `).run(msgId, threadId, accountId, senderName, body, ts);

                db.prepare(`
                    UPDATE inbound_events
                    SET status = 'stored', updated_at = ?
                    WHERE event_key = ?
                `).run(Date.now(), eventKey);

                return inboundEventId;
            });
            const insertedEventId = insertTx();
            if (!insertedEventId) {
                return;
            }

            // Store for outbox enqueue linkage below.
            data._inboundEventId = insertedEventId;
        } catch (err) {
            console.error('[Monitor] DB write error:', err.message);
        }

        // Push to renderer
        if (this._mainWindow && !this._mainWindow.isDestroyed()) {
            this._mainWindow.webContents.send('new-message-notification', {
                accountId, threadId, senderName, body, timestamp: ts, detectedBy,
            });
        }

        // Push to Telegram — only when we have a real conversation ID (never send without reply context).
        if (this._telegramBot) {
            let acc;
            try {
                acc = db.prepare('SELECT nickname, fb_name FROM accounts WHERE id = ?').get(accountId);
            } catch (_) { acc = null; }
            let label = (acc && (acc.fb_name || acc.nickname)) || accountId;
            label = label.replace(/^\(\d+\+?\)\s*/, '');

            const isRealConvId = threadId && !threadId.startsWith('unknown_');
            let replyCtx = isRealConvId ? { accountId, conversationId: threadId, senderName, accountLabel: label } : null;

            if (!isRealConvId) {
                // Try to resolve conversationId from current sidebar state (match by senderName + body/preview).
                const state = this.accounts.get(accountId);
                if (state && state.sidebarState && state.sidebarState.size > 0) {
                    const senderNorm = (senderName || '').trim().toLowerCase();
                    let matchedConvId = null;
                    let matchedUnread = false;
                    for (const [convId, entry] of state.sidebarState) {
                        const entrySender = (entry.senderName || '').trim().toLowerCase();
                        if (entrySender !== senderNorm) continue;
                        if (!sidebarMatchPreview(body, entry)) continue;
                        const unread = !!entry.isUnread;
                        if (!matchedConvId || unread) {
                            matchedConvId = convId;
                            matchedUnread = unread;
                            if (unread) break;
                        }
                    }
                    if (matchedConvId) {
                        replyCtx = { accountId, conversationId: matchedConvId, senderName, accountLabel: label };
                    }
                }
                if (replyCtx) {
                    NotificationOutbox.enqueue(
                        { senderName, body, accountId, accountLabel: label, timestamp: ts },
                        replyCtx,
                        { inboundEventId: data._inboundEventId || null }
                    );
                } else {
                    // No match — add to pending so a later _pollSidebar can send when sidebar has the conv.
                    if (!this._pendingTelegram.has(key)) {
                        const timer = setTimeout(() => {
                            this._pendingTelegram.delete(key);
                        }, PENDING_TELEGRAM_TTL_MS);
                        this._pendingTelegram.set(key, { accountId, senderName, body, timestamp: ts, timer });
                    }
                }
            } else {
                NotificationOutbox.enqueue(
                    { senderName, body, accountId, accountLabel: label, timestamp: ts },
                    replyCtx,
                    { inboundEventId: data._inboundEventId || null }
                );
            }
        }
    }
}

module.exports = new MessageMonitor();
