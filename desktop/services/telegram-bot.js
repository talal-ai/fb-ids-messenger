
const TelegramBot = require('node-telegram-bot-api');
const Store = require('electron-store');
const store = new Store();
const ReplyService = require('./reply-service');
const Database = require('../db/database');

const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');

let bot = null;
let chatId = null;
let lastConnectivity = null;
let conflictLogged = false;
let initInProgress = false;

// ── Active conversation registry ────────────────────────────────────────────
// Maps a stable slot number → conversation context.
// Slot numbers are assigned sequentially and NEVER reused or wrapped.
// This means operator can safely type "/re 3 message" at any time — #3 always
// means the same conversation, even after 100 more messages arrive.
// Old entries expire after TTL and are removed from /list output, but their
// slot number is never recycled (convSlotCounter only increments).
const activeConvs = new Map();  // slot (number) → { accountId, conversationId, senderName, accountLabel, lastAt }
// Secondary index: "accountId|conversationId" → slot — prevents duplicate tracking
const convKeyToSlot = new Map();
let convSlotCounter = 0;
const MAX_ACTIVE_CONVS = 50; // keep more — slots never wrap so this is just a display cap for /list
const ACTIVE_CONV_TTL_MS = 8 * 60 * 60 * 1000;  // 8 hours

// ── Serial notification queue ───────────────────────────────────────────────
// Ensures notifications are sent ONE AT A TIME so the active-conv ring stays
// ordered and reply_context DB writes never race with each other.
let _notifQueue = Promise.resolve();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape HTML special characters for Telegram HTML parse mode.
 * Simpler and more reliable than MarkdownV2 — just &, <, > need escaping.
 */
function h(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Parse the embedded routing reference from a Telegram notification text.
 * Every notification ends with a line:  ref:ACCOUNTID:CONVID
 * This is the fallback when the reply_context DB lookup fails.
 */
function parseRefFromText(text) {
    if (!text) return null;
    const match = text.match(/ref:([^\s:]+):([^\s\n]+)/);
    if (!match) return null;
    const accountId = match[1];
    const conversationId = match[2];
    if (!accountId || !conversationId) return null;
    return { accountId, conversationId };
}

/**
 * Track a conversation in the active-conv registry.
 * If already tracked (by accountId + conversationId), updates timestamp and returns the same slot.
 * If new, assigns the next slot number — slot numbers are NEVER reused or wrapped.
 * Returns the slot number.
 */
function trackActiveConv(context) {
    if (!context || !context.accountId || !context.conversationId) return null;

    const key = `${context.accountId}|${context.conversationId}`;

    // Already tracked — update in-place, return same slot
    if (convKeyToSlot.has(key)) {
        const slot = convKeyToSlot.get(key);
        const entry = activeConvs.get(slot);
        if (entry) {
            entry.senderName = context.senderName || entry.senderName;
            entry.accountLabel = context.accountLabel || entry.accountLabel;
            entry.lastAt = Date.now();
        }
        return slot;
    }

    // New conversation — assign next slot (never wraps)
    convSlotCounter++;
    const slot = convSlotCounter;
    activeConvs.set(slot, {
        accountId: context.accountId,
        conversationId: context.conversationId,
        senderName: context.senderName || 'Unknown',
        accountLabel: context.accountLabel || context.accountId,
        lastAt: Date.now(),
    });
    convKeyToSlot.set(key, slot);

    // Evict oldest TTL-expired entries from the Map to prevent unbounded growth
    if (activeConvs.size > MAX_ACTIVE_CONVS * 2) {
        const now = Date.now();
        for (const [s, e] of activeConvs) {
            if ((now - e.lastAt) > ACTIVE_CONV_TTL_MS) {
                convKeyToSlot.delete(`${e.accountId}|${e.conversationId}`);
                activeConvs.delete(s);
            }
        }
    }

    return slot;
}

/** Returns active conversations sorted by most recent first, excluding TTL-expired entries. */
function getActiveConvsSorted() {
    const now = Date.now();
    return [...activeConvs.entries()]
        .filter(([, e]) => (now - e.lastAt) < ACTIVE_CONV_TTL_MS)
        .sort((a, b) => b[1].lastAt - a[1].lastAt);
}

/** Human-readable relative time (e.g. "2m ago"). */
function relativeTime(ms) {
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Connection helpers ──────────────────────────────────────────────────────

// Helper to test connection with a specific agent
function testConnection(token, agent) {
    return new Promise((resolve) => {
        const options = {
            method: 'GET',
            timeout: 10000 // 10s timeout
        };
        if (agent) options.agent = agent;

        const req = https.request(`https://api.telegram.org/bot${token}/getMe`, options, (res) => {
            // Any response code means we reached the server (200, 401, etc)
            // If network is blocked, we won't get here
            resolve(true); 
        });

        req.on('error', (err) => {
            console.log(`[Telegram] Connection test failed: ${err.message}`);
            resolve(false);
        });

        req.on('timeout', () => {
             console.log('[Telegram] Connection test timed out');
             req.destroy();
             resolve(false);
        });

        req.end();
    });
}

function getProxyAgent(proxyUrl) {
    if (!proxyUrl || proxyUrl.trim() === '') return null;

    let formattedProxy = proxyUrl.trim();
    if (!formattedProxy.match(/^[a-zA-Z]+:\/\//)) {
        formattedProxy = `http://${formattedProxy}`;
    }

    if (formattedProxy.startsWith('socks')) {
        return new SocksProxyAgent(formattedProxy);
    }
    return new HttpsProxyAgent(formattedProxy);
}

function sendTelegramApiMessage(token, targetChatId, text, agent) {
    return new Promise((resolve) => {
        // Telegram API expects chat_id as integer for private chats
        const numericId = Number(targetChatId);
        const chatIdValue = Number.isFinite(numericId) ? numericId : targetChatId;

        const payload = JSON.stringify({
            chat_id: chatIdValue,
            text,
            parse_mode: 'HTML'
        });

        console.log('[Telegram] sendMessage → chat_id present, type=', typeof chatIdValue);

        const options = {
            method: 'POST',
            hostname: 'api.telegram.org',
            path: `/bot${token}/sendMessage`,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 12000
        };

        if (agent) options.agent = agent;

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk.toString());
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(body || '{}');
                        if (parsed.ok) return resolve({ ok: true });
                        return resolve({ ok: false, error: parsed.description || 'Telegram API returned not ok' });
                    } catch (_) {
                        return resolve({ ok: true });
                    }
                }

                try {
                    const parsed = JSON.parse(body || '{}');
                    resolve({ ok: false, error: parsed.description || `HTTP ${res.statusCode}` });
                } catch (_) {
                    resolve({ ok: false, error: `HTTP ${res.statusCode}` });
                }
            });
        });

        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, error: 'timeout' });
        });

        req.write(payload);
        req.end();
    });
}

async function initBot(token, targetChatId, proxyUrl) {
    // Prevent overlapping inits
    if (initInProgress) {
        console.log('[Telegram] Init already in progress, skipping duplicate call');
        return;
    }
    initInProgress = true;

    if (bot) {
        try {
            await bot.stopPolling();
            // Give Telegram API time to release the polling connection
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) { /* ignore */ }
        bot = null;
    }
    conflictLogged = false;

    let requestOptions = {};
    let proxyAgent = null;

    // 1. Prepare Proxy Agent if configured
    if (proxyUrl && proxyUrl.trim() !== '') {
        try {
            proxyAgent = getProxyAgent(proxyUrl);
            console.log(`[Telegram] configured proxy: ${proxyUrl}`);
        } catch (e) {
            console.error(`[Telegram] Failed to create proxy agent: ${e.message}`);
        }
    }

    // 2. Smart Connection Check
    console.log('[Telegram] Testing connection...');
    let shouldUseProxy = false;
    let strategy = 'DIRECT';

    if (proxyAgent) {
        // Try Proxy First
        console.log('[Telegram] Attempting connection via Proxy...');
        const proxySuccess = await testConnection(token, proxyAgent);
        if (proxySuccess) {
            console.log('[Telegram] Proxy connection SUCCESS.');
            shouldUseProxy = true;
            strategy = 'PROXY';
            lastConnectivity = { mode: 'proxy', ok: true };
        } else {
            console.error('[Telegram] Proxy connection FAILED. Falling back to Direct/VPN check...');
            // Fallback: Try Direct
            const directSuccess = await testConnection(token, null);
            if (directSuccess) {
                console.log('[Telegram] Direct/VPN connection SUCCESS.');
                shouldUseProxy = false;
                strategy = 'DIRECT';
                lastConnectivity = { mode: 'direct', ok: true };
            } else {
                console.error('[Telegram] Direct connection ALSO FAILED. Network might be completely blocked.');
                // We will default to Proxy just to keep the config active or maybe throw?
                // Providing the proxy agent allows it to retry in the polling loop
                shouldUseProxy = true; 
                strategy = 'PROXY (Retry)';
                lastConnectivity = { mode: 'none', ok: false, error: 'Direct and proxy both failed reachability check' };
            }
        }
    } else {
        // No Proxy configured - Direct Only
        strategy = 'DIRECT';
        const directSuccess = await testConnection(token, null);
        lastConnectivity = directSuccess
            ? { mode: 'direct', ok: true }
            : { mode: 'direct', ok: false, error: 'Direct reachability check failed' };
    }

    // 3. Initialize Bot
    if (shouldUseProxy && proxyAgent) {
        requestOptions.agent = proxyAgent;
    }

    console.log(`[Telegram] Initializing Bot with strategy: ${strategy}`);
    
    // Safety check for token — always reset chatId so stale value never leaks (fix C-4)
    chatId = null;
    if (!token) {
        console.error('[Telegram] Cannot start bot: Token is missing!');
        initInProgress = false;
        return;
    }

    bot = new TelegramBot(token, {
        polling: true,
        request: requestOptions
    });
    chatId = targetChatId;

    console.log('[Telegram] Bot started');
    
    // Error handler for polling errors to prevent unhandled rejections
    bot.on('polling_error', async (error) => {
        const msg = `${error.code || ''} ${error.message || ''}`;
        if (msg.includes('409 Conflict') && msg.includes('getUpdates request')) {
            if (!conflictLogged) {
                conflictLogged = true;
                console.error('[Telegram] Polling conflict (409): another app/device is using the same bot token via long polling. Close other instances and restart this app.');
            }
            try {
                await bot.stopPolling();
            } catch (_) { }
            return;
        }
        console.error(`[Telegram] Polling error: ${error.code} - ${error.message}`);
    });

    bot.on('message', async (msg) => {
        try {
            // Auto-persist chat id only if no chat_id is configured yet.
            // This prevents routing from switching when another user/group messages the bot.
            try {
                const incomingId = String(msg.chat && msg.chat.id);
                if ((!chatId || String(chatId).trim() === '') && incomingId) {
                    chatId = incomingId;
                    store.set('telegram_chat_id', chatId);
                    console.log('[Telegram] Auto-saved chat_id', chatId);
                }
            } catch (_) {}

            if (!msg.text) return;
            const text = msg.text.trim();
            const tgChatId = msg.chat.id;

            // Process commands only from the configured chat.
            // This keeps message/reply routing deterministic for one operator endpoint.
            if (chatId && String(tgChatId) !== String(chatId)) {
                console.warn(`[Telegram] Ignoring message from unauthorized chat: ${tgChatId}`);
                return;
            }

            // ── METHOD 1: Swipe-Reply ────────────────────────────────────
            // Operator swipes on any notification and types a reply.
            // Step 1: DB lookup by telegram message_id (primary routing).
            // Step 2: If DB fails, parse the embedded ref:ACC:CONV code from the
            //         quoted message text (fallback — always works).
            if (msg.reply_to_message) {
                let ctx = null;

                // Step 1 — DB lookup
                try {
                    const db = Database.getDb();
                    const row = db.prepare(
                        'SELECT account_id, conversation_id, sender_name FROM reply_context WHERE telegram_msg_id = ?'
                    ).get(msg.reply_to_message.message_id);
                    if (row) {
                        ctx = { accountId: row.account_id, conversationId: row.conversation_id, senderName: row.sender_name };
                    }
                } catch (dbErr) {
                    console.error('[Telegram] reply_context lookup failed:', dbErr.message);
                }

                // Step 2 — Fallback: parse ref: code from quoted message text
                if (!ctx) {
                    const quotedText = msg.reply_to_message.text || '';
                    const parsed = parseRefFromText(quotedText);
                    if (parsed) {
                        // Enrich with senderName from active-conv ring if available
                        for (const [, entry] of activeConvs) {
                            if (entry.accountId === parsed.accountId && entry.conversationId === parsed.conversationId) {
                                parsed.senderName = entry.senderName;
                                break;
                            }
                        }
                        ctx = parsed;
                        console.log('[Telegram] Swipe-reply routed via ref: fallback');
                    }
                }

                if (ctx) {
                    await _sendFbReply(tgChatId, ctx.accountId, ctx.conversationId, ctx.senderName, text);
                } else {
                    // Both DB and fallback failed — give operator actionable alternatives
                    const convs = getActiveConvsSorted();
                    let errMsg = '⚠️ <b>Cannot route reply</b> — conversation ID not found.\n\n';
                    if (convs.length > 0) {
                        errMsg += 'Use /list to see active conversations, then reply with:\n';
                        errMsg += '<code>/re 1 your message</code>\n\n';
                        errMsg += '<b>Recent conversations:</b>\n';
                        for (const [slot, entry] of convs.slice(0, 5)) {
                            errMsg += `  #${slot} — ${h(entry.senderName)} → ${h(entry.accountLabel)} (${relativeTime(entry.lastAt)})\n`;
                        }
                    } else {
                        errMsg += 'No active conversations tracked yet.';
                    }
                    bot.sendMessage(tgChatId, errMsg, { parse_mode: 'HTML' });
                }
                return;
            }

            // ── /list (or /active) ———  Show active conversations ───────
            if (text === '/list' || text === '/active' || text === '/l') {
                const convs = getActiveConvsSorted();
                if (convs.length === 0) {
                    bot.sendMessage(tgChatId,
                        '📭 No active conversations in the last 8 hours.\n\nThey appear automatically when new messages arrive.',
                        { parse_mode: 'HTML' });
                    return;
                }
                const lines = ['📋 <b>Active Conversations</b>\n'];
                for (const [slot, entry] of convs) {
                    lines.push(`<b>${slot}.</b> ${h(entry.senderName)} → ${h(entry.accountLabel)}  <i>(${relativeTime(entry.lastAt)})</i>`);
                }
                lines.push('');
                lines.push('Reply: <code>/re N your message</code>');
                bot.sendMessage(tgChatId, lines.join('\n'), { parse_mode: 'HTML' });
                return;
            }

            // ── /re N message ─────  Reply to conversation by slot number ─
            if (/^\/re(\s|$)/i.test(text)) {
                const parts = text.split(/\s+/);
                const slot = parseInt(parts[1], 10);
                const message = parts.slice(2).join(' ');

                if (isNaN(slot) || slot < 1) {
                    bot.sendMessage(tgChatId,
                        '❌ Usage: <code>/re N your message</code>\nUse /list to see conversation numbers.',
                        { parse_mode: 'HTML' });
                    return;
                }

                const entry = activeConvs.get(slot);
                if (!entry) {
                    const convs = getActiveConvsSorted();
                    let errMsg = `❌ Conversation <b>#${slot}</b> not found or expired.\n\n`;
                    if (convs.length > 0) {
                        errMsg += '<b>Available:</b>\n';
                        for (const [s, e] of convs.slice(0, 8)) {
                            errMsg += `  #${s} — ${h(e.senderName)} (${relativeTime(e.lastAt)})\n`;
                        }
                    }
                    bot.sendMessage(tgChatId, errMsg, { parse_mode: 'HTML' });
                    return;
                }

                if (!message) {
                    // Just show conversation info
                    bot.sendMessage(tgChatId,
                        `ℹ️ Conversation <b>#${slot}</b>:\n${h(entry.senderName)} → ${h(entry.accountLabel)}\nLast message: ${relativeTime(entry.lastAt)}\n\nTo reply: <code>/re ${slot} your message</code>`,
                        { parse_mode: 'HTML' });
                    return;
                }

                await _sendFbReply(tgChatId, entry.accountId, entry.conversationId, entry.senderName, message);
                return;
            }

            // ── /reply accId convId message ──  Advanced / debug routing ──
            if (text.startsWith('/reply ')) {
                const parts = text.split(/\s+/);
                if (parts.length < 4) {
                    bot.sendMessage(tgChatId,
                        '❌ Usage: <code>/reply &lt;accountId&gt; &lt;conversationId&gt; &lt;message&gt;</code>',
                        { parse_mode: 'HTML' });
                    return;
                }
                const accountId = parts[1];
                const conversationId = parts[2];
                const message = parts.slice(3).join(' ');
                // Validate account exists before routing
                try {
                    const db = Database.getDb();
                    const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
                    if (!acc) {
                        bot.sendMessage(tgChatId,
                            `❌ Account <code>${h(accountId)}</code> not found. Use /status to list accounts.`,
                            { parse_mode: 'HTML' });
                        return;
                    }
                } catch (_) {}
                await _sendFbReply(tgChatId, accountId, conversationId, null, message);
                return;
            }

            // ── /status ──────────────────────────────────────────────────
            if (text === '/status') {
                try {
                    const db = Database.getDb();
                    const accounts = db.prepare('SELECT id, nickname, fb_name, status FROM accounts').all();
                    if (!accounts.length) {
                        bot.sendMessage(tgChatId, 'No accounts configured.');
                        return;
                    }
                    const lines = ['📊 <b>Accounts</b>\n'];
                    for (const a of accounts) {
                        const label = a.fb_name || a.nickname || a.id;
                        const statusIcon = a.status === 'active' ? '🟢' : a.status === 'needs_login' ? '🔴' : '⚫';
                        lines.push(`${statusIcon} ${h(label)} — <code>${h(a.id)}</code>`);
                    }
                    bot.sendMessage(tgChatId, lines.join('\n'), { parse_mode: 'HTML' });
                } catch (e) {
                    bot.sendMessage(tgChatId, `Error: ${h(e.message)}`, { parse_mode: 'HTML' });
                }
                return;
            }

            // ── /help or /start ───────────────────────────────────────────
            if (text === '/help' || text === '/start') {
                const helpText = [
                    '📬 <b>Multi-FB Manager</b>',
                    '',
                    '<b>Replying to Facebook messages:</b>',
                    '',
                    '1️⃣ <b>Swipe Reply</b> (recommended)',
                    '   Long-press any notification → Reply.',
                    '   Works even if you receive 50 messages at once.',
                    '',
                    '2️⃣ <b>/list</b>',
                    '   Shows all active conversations with numbers.',
                    '',
                    '3️⃣ <b>/re N your message</b>',
                    '   Reply to conversation #N from /list.',
                    '   e.g. <code>/re 1 Yes, still available!</code>',
                    '',
                    '4️⃣ <b>/reply accId convId message</b>',
                    '   Advanced routing with explicit IDs.',
                    '',
                    '📊 /status — show accounts',
                    '📋 /list   — show active conversations',
                ].join('\n');
                bot.sendMessage(tgChatId, helpText, { parse_mode: 'HTML' });
                return;
            }

        } catch (outerErr) {
            console.error('[Telegram] Unhandled error in message handler:', outerErr.message);
            try { bot.sendMessage(msg.chat.id, '❌ Internal error. Please try again.'); } catch (_) {}
        }
    });

    // Internal: execute the Facebook reply (called from all routing methods above)
    async function _sendFbReply(tgChatId, accountId, conversationId, senderName, message) {
        const label = senderName ? `to <b>${h(senderName)}</b>` : `on <code>${h(accountId)}</code>`;
        try {
            bot.sendMessage(tgChatId, `⏳ Sending reply ${label}...`, { parse_mode: 'HTML' });
            const result = await ReplyService.queueReply(accountId, conversationId, message);
            if (result.success) {
                bot.sendMessage(tgChatId, `✅ Reply sent ${label}`, { parse_mode: 'HTML' });
            } else {
                bot.sendMessage(tgChatId, `❌ Reply failed ${label}: ${h(result.reason)}`, { parse_mode: 'HTML' });
            }
        } catch (err) {
            bot.sendMessage(tgChatId, `❌ Failed ${label}: ${h(err.message)}`, { parse_mode: 'HTML' });
        }
    }

    initInProgress = false;
}

/**
 * Send a notification to the operator's Telegram chat.
 *
 * Accepts a structured notifData object so this module owns formatting.
 * Enqueued serially — notifications are NEVER sent concurrently.
 * This ensures:
 *   - activeConvs ring stays correctly ordered
 *   - reply_context DB writes never race
 *   - lastIncoming / slot numbers are stable before the next notification
 *
 * @param {object} notifData - { senderName, body, accountId, accountLabel, timestamp }
 * @param {object|null} context  - { accountId, conversationId, senderName, accountLabel } for reply routing
 */
function sendNotification(notifData, context) {
    _notifQueue = _notifQueue
        .then(() => _doSendNotification(notifData, context))
        .catch(() => {}); // keep the chain alive on error
    return _notifQueue;
}

async function _doSendNotification(notifData, context) {
    if (!bot || !chatId) {
        console.warn('[Telegram] Cannot send notification: bot or chatId not ready');
        return null;
    }

    const { senderName = 'Unknown', body = '', accountId = '', accountLabel = accountId, timestamp } = notifData || {};

    // Assign a slot number BEFORE sending so it's in the message
    const slot = context ? trackActiveConv({ ...context, accountLabel }) : null;
    const slotTag = slot ? ` • <b>#${slot}</b>` : '';

    const dateStr = new Date(timestamp || Date.now()).toLocaleString();

    // Build notification with HTML (no backslash escaping issues)
    // The last line embeds the routing ref as a parseable fallback for swipe-reply
    const lines = [
        `📩 <b>${h(senderName)}</b>`,
        `💬 ${h(body)}`,
        ``,
        `🏪 ${h(accountLabel)}${slotTag}`,
        `🕒 ${dateStr}`,
    ];

    if (context && context.conversationId && !context.conversationId.startsWith('unknown_')) {
        // Embedded routing reference — machine-parseable fallback for swipe-reply
        lines.push(`<code>ref:${accountId}:${context.conversationId}</code>`);
        lines.push(`↩ Swipe to reply${slot ? ` • or: /re ${slot} message` : ''}`);
    } else {
        lines.push(`⚠️ Conversation ID not yet resolved — swipe-reply may not work`);
        if (slot) lines.push(`Use: /re ${slot} message`);
    }

    const text = lines.join('\n');

    const retries = 3;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
            console.log(`[Telegram] Notification sent (slot=${slot}, msg_id=${sentMsg && sentMsg.message_id})`);

            // Persist reply_context so swipe-reply survives bot restarts
            if (sentMsg && sentMsg.message_id && context && context.conversationId) {
                try {
                    const db = Database.getDb();
                    db.prepare(`
                        INSERT OR REPLACE INTO reply_context (telegram_msg_id, account_id, conversation_id, sender_name, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(sentMsg.message_id, context.accountId, context.conversationId, context.senderName, Date.now());
                } catch (dbErr) {
                    console.error('[Telegram] Failed to persist reply_context:', dbErr.message);
                }
            }
            return sentMsg;
        } catch (err) {
            console.error(`[Telegram] Notification attempt ${attempt}/${retries} failed:`, err.message);
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s backoff
            }
        }
    }
    console.error('[Telegram] All notification attempts failed');
    return null;
}

async function sendTestMessage(token, targetChatId, proxyUrl) {
    if (!token || !token.trim()) {
        return { success: false, error: 'Missing Telegram Bot Token' };
    }
    if (!targetChatId || !String(targetChatId).trim()) {
        return { success: false, error: 'Missing Telegram Chat ID' };
    }

    const text = '✅ <b>Test message from FB Hub!</b>\n\nYour Telegram integration is working correctly.';

    let proxyAgent = null;
    if (proxyUrl && proxyUrl.trim() !== '') {
        try {
            proxyAgent = getProxyAgent(proxyUrl);
        } catch (e) {
            return { success: false, error: `Invalid proxy format: ${e.message}` };
        }
    }

    if (proxyAgent) {
        const viaProxy = await sendTelegramApiMessage(token, targetChatId, text, proxyAgent);
        if (viaProxy.ok) {
            return { success: true, route: 'proxy' };
        }

        const viaDirect = await sendTelegramApiMessage(token, targetChatId, text, null);
        if (viaDirect.ok) {
            return { success: true, route: 'direct', warning: `Proxy failed (${viaProxy.error}); sent directly.` };
        }

        return {
            success: false,
            error: `Both proxy and direct failed. Proxy: ${viaProxy.error}. Direct: ${viaDirect.error}`,
            connectivity: lastConnectivity
        };
    }

    const viaDirect = await sendTelegramApiMessage(token, targetChatId, text, null);
    if (viaDirect.ok) {
        return { success: true, route: 'direct' };
    }

    return {
        success: false,
        error: `Direct send failed: ${viaDirect.error}`,
        connectivity: lastConnectivity
    };
}

/**
 * Calls getUpdates to find the chat ID from the most recent message sent to the bot.
 * User must send /start or any message to the bot first.
 */
async function detectChatId(token, proxyUrl) {
    if (!token || !token.trim()) {
        return { success: false, error: 'Missing Bot Token' };
    }

    let agent = null;
    if (proxyUrl && proxyUrl.trim() !== '') {
        try { agent = getProxyAgent(proxyUrl); } catch (_) { }
    }

    return new Promise((resolve) => {
        const options = {
            method: 'GET',
            hostname: 'api.telegram.org',
            path: `/bot${token}/getUpdates?limit=10&timeout=0`,
            timeout: 12000
        };
        if (agent) options.agent = agent;

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk.toString());
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (!data.ok || !data.result || data.result.length === 0) {
                        console.log('[Telegram] detectChatId got updates:', JSON.stringify(data, null, 2));
                        return resolve({ success: false, error: 'No messages found. Send /start to your bot in Telegram first, then try again.', updates: data });
                    }
                    console.log('[Telegram] detectChatId updates:', JSON.stringify(data.result, null, 2));
                    // Find the latest message with a chat id
                    const latest = data.result[data.result.length - 1];
                    const chat = latest.message?.chat || latest.edited_message?.chat;
                    if (!chat) {
                        return resolve({ success: false, error: 'Could not extract chat info from updates.', updates: data });
                    }
                    return resolve({
                        success: true,
                        chatId: String(chat.id),
                        chatName: chat.first_name || chat.title || chat.username || '',
                        updates: data.result
                    });
                } catch (e) {
                    resolve({ success: false, error: `Parse error: ${e.message}` });
                }
            });
        });

        req.on('error', (err) => resolve({ success: false, error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'timeout' }); });
        req.end();
    });
}

module.exports = { initBot, sendTestMessage, detectChatId, sendNotification };
