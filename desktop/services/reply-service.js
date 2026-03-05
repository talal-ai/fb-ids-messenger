/**
 * Reply Service (Playwright)
 * 
 * Handles the full reply lifecycle using Playwright pages:
 *   1. Navigate to the correct conversation URL
 *   2. Wait for the textbox to appear
 *   3. Type the message with human-like delays
 *   4. Press Enter to send
 *   5. Navigate back to inbox so message detection resumes
 * 
 * Manages a per-account reply queue so rapid replies
 * don't thrash navigation on the same browser context.
 */

const PlaywrightManager = require('./playwright-manager');
const MessageMonitor = require('./message-monitor');

// Base URL for navigating conversations. facebook.com/messages maintains the same threads
const MESSENGER_BASE = 'https://www.facebook.com/messages';
const NAV_TIMEOUT = 20000;       // 20s to load conversation page
const MIN_REPLY_GAP_MS = 3000;   // Minimum 3s between replies on same account

// Per-account queues: accountId -> { queue: [], processing: bool }
const accountQueues = new Map();

/**
 * Queue a reply for a specific account. Replies are processed sequentially.
 * 
 * @param {string} accountId - Which account to reply from
 * @param {string} conversationId - Facebook thread ID (numeric)
 * @param {string} message - Reply text
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
function queueReply(accountId, conversationId, message) {
    return new Promise((resolve) => {
        if (!accountQueues.has(accountId)) {
            accountQueues.set(accountId, { queue: [], processing: false });
        }

        const entry = accountQueues.get(accountId);
        entry.queue.push({ conversationId, message, resolve });

        // Start processing if not already running
        if (!entry.processing) {
            processQueue(accountId);
        }
    });
}

/**
 * Process the reply queue for a specific account, one at a time.
 */
async function processQueue(accountId) {
    const entry = accountQueues.get(accountId);
    if (!entry || entry.queue.length === 0) {
        if (entry) entry.processing = false;
        return;
    }

    entry.processing = true;
    const { conversationId, message, resolve } = entry.queue.shift();

    try {
        const result = await executeReply(accountId, conversationId, message);
        resolve(result);
    } catch (err) {
        console.error(`[ReplyService] Unexpected error in queue for ${accountId}:`, err.message);
        resolve({ success: false, reason: `unexpected: ${err.message}` });
    } finally {
        // Always release the processing lock, even if sleep or next call throws
        try { await sleep(MIN_REPLY_GAP_MS); } catch (_) {}
        entry.processing = false;
        // Process next item in queue if any
        if (entry.queue.length > 0) processQueue(accountId);
    }
}

/**
 * Execute a single reply: navigate → type → send → navigate back.
 */
async function executeReply(accountId, conversationId, message) {
    const page = await PlaywrightManager.getMessengerPage(accountId);
    if (!page) {
        return { success: false, reason: `Account ${accountId} not found or page not available` };
    }

    if (!conversationId) {
        return { success: false, reason: `No conversationId provided for reply on ${accountId}` };
    }

    // Snapshot sidebar state BEFORE navigating away so the monitor can
    // reconcile any messages that arrived during the reply navigation gap
    try {
        const state = MessageMonitor.accounts.get(accountId);
        if (state) {
            state._replySnapshot = new Map(state.sidebarState);
        }
    } catch (_) {}

    // Lock detection immediately so polls during navigation don't fire spurious notifications
    try { MessageMonitor.lockReply(accountId, conversationId); } catch (_) {}
    console.log(`[ReplyService] Replying on ${accountId} to conversation ${conversationId}`);

    // Candidate conversation URLs
    const convoUrls = [
        `${MESSENGER_BASE}/t/${conversationId}/`,
        `${MESSENGER_BASE}/e2ee/t/${conversationId}/`,
    ];

    // Step 1: Navigate to conversation
    let navigated = false;
    let lastError = null;

    for (const url of convoUrls) {
        try {
            console.log(`[ReplyService] Navigating to ${url}`);
            // ensure we land on facebook domain so cookies apply correctly
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
            await sleep(2000); // Let React/SPA render

            // Check for textbox
            const textbox = await page.$('div[role="textbox"][contenteditable="true"], div[aria-label="Message"][contenteditable="true"], div[aria-label="Type a message"][contenteditable="true"]');
            if (textbox) {
                navigated = true;
                console.log(`[ReplyService] Textbox found at ${url}`);
                break;
            }

            // Retry after brief wait (E2EE can be slow)
            await sleep(3000);
            const textboxRetry = await page.$('div[role="textbox"][contenteditable="true"], div[aria-label="Message"][contenteditable="true"], div[aria-label="Type a message"][contenteditable="true"]');
            if (textboxRetry) {
                navigated = true;
                console.log(`[ReplyService] Textbox found (retry) at ${url}`);
                break;
            }

            lastError = new Error('Textbox not found on page');
        } catch (err) {
            lastError = err;
            console.warn(`[ReplyService] Navigation failed for ${url}:`, err.message);
        }
    }

    if (!navigated) {
        const errMsg = lastError ? lastError.message : 'unknown';
        console.error(`[ReplyService] Could not load conversation: ${errMsg}`);
        safeNavigateBack(page);
        return { success: false, reason: `navigation-failed: ${errMsg}` };
    }

    // Step 2: Click textbox, type, and send
    try {
        const textbox = await page.$('div[role="textbox"][contenteditable="true"], div[aria-label="Message"][contenteditable="true"], div[aria-label="Type a message"][contenteditable="true"]');
        if (!textbox) {
            // DOM may have changed between navigation check and now
            console.error('[ReplyService] Textbox disappeared before click');
            safeNavigateBack(page);
            return { success: false, reason: 'textbox-disappeared' };
        }
        await textbox.click();
        await sleep(300);

        // Type with human-like delays
        await page.keyboard.type(message, { delay: 40 + Math.random() * 40 });
        await sleep(500);

        // Send
        await page.keyboard.press('Enter');
        console.log(`[ReplyService] Message sent on ${accountId} to ${conversationId}`);

        await sleep(1000);
    } catch (err) {
        console.error(`[ReplyService] Typing/sending failed:`, err.message);
        safeNavigateBack(page);
        return { success: false, reason: `send-failed: ${err.message}` };
    }

    // Mark conversation as replied in monitor so it won't re-fire the same message
    // Pass the sent message text so the monitor can skip our own reply preview
    try { MessageMonitor.markReplied(accountId, conversationId, message); } catch (_) {}

    // Step 3: Navigate back to inbox so polling resumes on the sidebar
    safeNavigateBack(page);

    return { success: true };
}

/**
 * Navigate back to Messenger inbox. Fire-and-forget.
 */
async function safeNavigateBack(page) {
    try {
        await page.goto(MESSENGER_BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
        console.error('[ReplyService] Failed to navigate back to inbox:', e.message);
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = { queueReply };
