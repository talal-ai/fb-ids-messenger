
const TelegramBot = require('node-telegram-bot-api');
const Store = require('electron-store');
const store = new Store();
const PlaywrightManager = require('./playwright-manager');
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

// ── Reply context tracking ──────────────────────────────────────────────────
// Reply context is now persisted in SQLite (reply_context table) so it
// survives restarts and works for up to 30 days.
// Maps Telegram message_id → { accountId, conversationId, senderName }

// Track the most recent incoming conversation for /r shortcut
// Persisted to electron-store so it survives restarts
let lastIncoming = store.get('last_incoming_context') || null;


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
            parse_mode: 'Markdown'
        });

        console.log(`[Telegram] sendMessage → chat_id=${chatIdValue} (${typeof chatIdValue})`);

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
    
    // Safety check for token
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
        // auto-persist chat id of whoever talks to the bot
        try {
            const incomingId = String(msg.chat && msg.chat.id);
            if (incomingId && incomingId !== String(chatId)) {
                chatId = incomingId;
                store.set('telegram_chat_id', chatId);
                console.log('[Telegram] Auto-saved chat_id', chatId);
            }
        } catch (e) { /* ignore */ }

        if (!msg.text) return;
        const text = msg.text.trim();

        // ── Method 1: REPLY TO MESSAGE (most seamless) ──────────────────
        // User swipes/replies to a notification → auto-route the reply
        if (msg.reply_to_message && msg.reply_to_message.message_id) {
            try {
                const db = Database.getDb();
                const ctx = db.prepare('SELECT account_id, conversation_id, sender_name FROM reply_context WHERE telegram_msg_id = ?')
                    .get(msg.reply_to_message.message_id);
                if (ctx) {
                    await _sendFbReply(msg.chat.id, ctx.account_id, ctx.conversation_id, ctx.sender_name, text);
                    return;
                }
            } catch (dbErr) {
                console.error('[Telegram] Reply context DB lookup failed:', dbErr.message);
            }
            // Replied to a notification that has no routing context (unknown conv ID)
            bot.sendMessage(msg.chat.id,
                '⚠️ Cannot route this reply — conversation ID was not detected.\n'
                + 'Use /r <message> to reply to the last known conversation.');
            return;
        }

        // ── Method 2: /r <message> — reply to LAST conversation ─────────
        if (text.startsWith('/r ') || text.startsWith('/R ')) {
            if (!lastIncoming) {
                bot.sendMessage(msg.chat.id, '⚠️ No recent conversation to reply to. Wait for a new message first.');
                return;
            }
            const message = text.substring(3).trim();
            if (!message) {
                bot.sendMessage(msg.chat.id, 'Usage: /r <your message>');
                return;
            }
            await _sendFbReply(msg.chat.id, lastIncoming.accountId, lastIncoming.conversationId, lastIncoming.senderName, message);
            return;
        }

        // ── Method 3: /reply <accountId> <conversationId> <message> ─────
        if (text.startsWith('/reply ')) {
            const parts = text.split(' ');
            if (parts.length < 4) {
                bot.sendMessage(msg.chat.id, 'Usage: /reply <accountId> <conversationId> <message>');
                return;
            }
            const accountId = parts[1];
            const conversationId = parts[2];
            const message = parts.slice(3).join(' ');
            await _sendFbReply(msg.chat.id, accountId, conversationId, null, message);
            return;
        }

        // ── /help command ───────────────────────────────────────────────
        if (text === '/help' || text === '/start') {
            const helpText = [
                '📬 *Multi-FB Manager Bot*',
                '',
                '*How to reply to Facebook messages:*',
                '',
                '1️⃣ *Swipe Reply* (easiest):',
                '   Just reply to any notification message',
                '   and your text is sent to that conversation.',
                '',
                '2️⃣ */r <message>*:',
                '   Quick reply to the most recent conversation.',
                '   Example: `/r Hey, I will check!`',
                '',
                '3️⃣ */reply <acc> <conv> <msg>*:',
                '   Manual reply with full IDs (advanced).',
                '',
                '📊 */status* — Show active accounts',
            ].join('\n');
            bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
            return;
        }

        // ── /status command ─────────────────────────────────────────────
        if (text === '/status') {
            try {
                const Database = require('../db/database');
                const db = Database.getDb();
                const accounts = db.prepare('SELECT id, nickname, fb_name FROM accounts').all();
                if (!accounts.length) {
                    bot.sendMessage(msg.chat.id, 'No accounts configured.');
                    return;
                }
                const lines = ['📊 *Active Accounts:*', ''];
                for (const a of accounts) {
                    const label = a.fb_name || a.nickname || a.id;
                    lines.push(`• ${label} (\`${a.id}\`)`);
                }
                bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
            } catch (e) {
                bot.sendMessage(msg.chat.id, `Error: ${e.message}`);
            }
            return;
        }
        } catch (outerErr) {
            console.error('[Telegram] Unhandled error in message handler:', outerErr.message);
            try { bot.sendMessage(msg.chat.id, '❌ Internal error. Please try again.'); } catch (_) {}
        }
    });
    async function _sendFbReply(tgChatId, accountId, conversationId, senderName, message) {
        const label = senderName ? `to ${senderName}` : `on ${accountId}`;
        try {
            bot.sendMessage(tgChatId, `⏳ Sending reply ${label}...`);
            const result = await ReplyService.queueReply(accountId, conversationId, message);
            if (result.success) {
                bot.sendMessage(tgChatId, `✅ Reply sent ${label}`);
            } else {
                bot.sendMessage(tgChatId, `❌ Reply failed: ${result.reason}`);
            }
        } catch (err) {
            bot.sendMessage(tgChatId, `❌ Failed: ${err.message}`);
        }
    }

    initInProgress = false;
}

/**
 * Escape Markdown special characters so Telegram doesn't choke on user content.
 */
function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/**
 * Send a notification message to the configured Telegram chat.
 * Called by MessageMonitor when a new FB message arrives.
 * Returns the sent message object (has message_id for reply tracking).
 * Retries up to 3 times with exponential backoff.
 *
 * @param {string} text - Notification text
 * @param {object} [context] - { accountId, conversationId, senderName } for reply routing
 */
async function sendNotification(text, context, retries = 3) {
    if (!bot || !chatId) {
        console.warn('[Telegram] Cannot send notification: bot or chatId missing');
        return null;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            console.log('[Telegram] Notification sent');

            // Persist reply context to SQLite so swipe-replies work across restarts
            if (sentMsg && sentMsg.message_id && context) {
                try {
                    const db = Database.getDb();
                    db.prepare(`
                        INSERT OR REPLACE INTO reply_context (telegram_msg_id, account_id, conversation_id, sender_name, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(sentMsg.message_id, context.accountId, context.conversationId, context.senderName, Date.now());
                } catch (dbErr) {
                    console.error('[Telegram] Failed to persist reply context:', dbErr.message);
                }

                // Update lastIncoming for /r shortcut (persisted to electron-store)
                lastIncoming = context;
                store.set('last_incoming_context', context);
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

    const text = '✅ *Test message from FB Hub!*\n\nYour Telegram integration is working correctly.';

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
