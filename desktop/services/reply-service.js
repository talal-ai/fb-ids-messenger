/**
 * Reply Service (Playwright + SQLite-backed queue)
 *
 * Handles the full reply lifecycle:
 *   1. Queue a reply into SQLite (survives crashes/restarts)
 *   2. Navigate to the correct conversation URL (invisible background operation)
 *   3. Wait for textbox, type with human-like delays, press Enter
 *   4. Navigate back to inbox so message detection resumes
 *   5. Mark reply as sent or failed (with retry + Telegram alert)
 *
 * Crash recovery: on startup, call recoverPendingReplies() to re-process
 * any replies that were pending when the app last died.
 */

const crypto = require('crypto');
const PlaywrightManager = require('./playwright-manager');
const MessageMonitor = require('./message-monitor');
const Database = require('../db/database');
const NotificationOutbox = require('./notification-outbox');
const { sha256Utf8 } = require('../../control-plane/lib/hashes');

const MESSENGER_BASE = 'https://www.facebook.com/messages';
const NAV_TIMEOUT = 20_000;      // 20s to load conversation page
const MIN_REPLY_GAP_MS = 3_000;  // Minimum gap between replies on same account
const MAX_ATTEMPTS = 3;          // Retry failed replies up to 3 times
const RETRY_BASE_MS = 10_000;    // 10s, 20s, 30s backoff

// In-memory processing lock per account (not durable — just prevents concurrent sends)
const processingLocks = new Set(); // accountId

const WORKER_ID = `electron-${process.pid}`;

function startAttempt(db, replyJobId, replyId) {
    // reply_job_id may be null if join failed — skip ledger
    if (!replyJobId) return null;
    const attemptId = crypto.randomUUID();
    const now = Date.now();
    db.prepare(`
        INSERT INTO reply_attempts (attempt_id, reply_job_id, reply_id, worker_id, started_at, finished_at, status, error_code, error_detail, sent_hash, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, 'sending', NULL, NULL, NULL, ?)
    `).run(attemptId, replyJobId, replyId || null, WORKER_ID, now, now);
    return attemptId;
}

function finishAttempt(db, attemptId, status, errorCode, errorDetail, sentHash) {
    if (!attemptId) return;
    db.prepare(`
        UPDATE reply_attempts
        SET finished_at = ?, status = ?, error_code = ?, error_detail = ?, sent_hash = ?
        WHERE attempt_id = ?
    `).run(Date.now(), status, errorCode || null, errorDetail || null, sentHash || null, attemptId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queue a reply for a specific account. Inserts into SQLite for crash-safety,
 * then immediately tries to process if not already running.
 *
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
function queueReply(accountId, conversationId, message) {
    return new Promise((resolve, reject) => {
        try {
            const db = Database.getDb();
            const now = Date.now();
            const replyId = crypto.randomUUID();
            const messageHash = sha256Utf8(message);
            const tx = db.transaction(() => {
                const result = db.prepare(`
                    INSERT INTO reply_queue (account_id, conversation_id, message, status, attempts, created_at, next_attempt_at)
                    VALUES (?, ?, ?, 'pending', 0, ?, ?)
                `).run(accountId, conversationId, message, now, now);

                // Dual-write into durable reply_jobs (new pipeline path) while legacy queue remains active.
                db.prepare(`
                    INSERT INTO reply_jobs
                        (legacy_queue_id, reply_id, message_hash, account_id, conversation_id, message_text, source, status, attempts, max_attempts,
                         next_attempt_at, created_at, updated_at)
                    VALUES
                        (?, ?, ?, ?, ?, ?, 'telegram', 'queued', 0, ?, ?, ?, ?)
                `).run(Number(result.lastInsertRowid), replyId, messageHash, accountId, conversationId, message, MAX_ATTEMPTS, now, now, now);

                return result;
            });

            const result = tx();

            const rowId = result.lastInsertRowid;
            console.log(`[ReplyService] Queued reply #${rowId} for ${accountId} → conv ${conversationId}`);

            // Fire-and-forget processing; caller gets result via the returned promise
            processQueue(accountId, rowId, resolve).catch(err => {
                console.error(`[ReplyService] processQueue error:`, err.message);
                resolve({ success: false, reason: `queue-error: ${err.message}` });
            });
        } catch (err) {
            console.error(`[ReplyService] Failed to queue reply:`, err.message);
            resolve({ success: false, reason: `db-error: ${err.message}` });
        }
    });
}

/**
 * API / control-plane path: durable queue with idempotency + canonical reply_id.
 * @returns {Promise<{ ok: boolean, reply_job_id?: number, legacy_queue_id?: number, reason?: string }>}
 */
function queueReplyFromCommand(opts) {
    const {
        replyId,
        idempotencyKey,
        eventId,
        accountId,
        conversationId,
        messageRaw,
        messageHash,
        expectedConversationVersion,
    } = opts;

    return new Promise((resolve) => {
        try {
            const db = Database.getDb();
            const now = Date.now();
            const tx = db.transaction(() => {
                const result = db.prepare(`
                    INSERT INTO reply_queue (account_id, conversation_id, message, status, attempts, created_at, next_attempt_at)
                    VALUES (?, ?, ?, 'pending', 0, ?, ?)
                `).run(accountId, conversationId, messageRaw, now, now);

                const qid = Number(result.lastInsertRowid);

                db.prepare(`
                    INSERT INTO reply_jobs
                        (legacy_queue_id, reply_id, idempotency_key, event_id, message_hash, expected_conversation_version,
                         account_id, conversation_id, message_text, source, status, attempts, max_attempts,
                         next_attempt_at, created_at, updated_at)
                    VALUES
                        (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api', 'queued', 0, ?, ?, ?, ?)
                `).run(
                    qid,
                    replyId,
                    idempotencyKey,
                    eventId,
                    messageHash,
                    expectedConversationVersion == null ? null : expectedConversationVersion,
                    accountId,
                    conversationId,
                    messageRaw,
                    MAX_ATTEMPTS,
                    now,
                    now,
                    now
                );

                const jobRow = db.prepare('SELECT id FROM reply_jobs WHERE legacy_queue_id = ?').get(qid);
                return { qid, reply_job_id: jobRow ? jobRow.id : null };
            });

            const { qid, reply_job_id } = tx();
            console.log(`[ReplyService] API queued reply ${replyId} queue=${qid} job=${reply_job_id}`);

            processQueue(accountId, qid, (r) => {
                resolve({
                    ok: r && r.success !== false,
                    reply_job_id,
                    legacy_queue_id: qid,
                    reason: r && r.reason,
                });
            }).catch((err) => {
                console.error('[ReplyService] processQueue error:', err.message);
                resolve({ ok: false, reason: `queue-error: ${err.message}` });
            });
        } catch (err) {
            console.error('[ReplyService] queueReplyFromCommand failed:', err.message);
            resolve({ ok: false, reason: err.message });
        }
    });
}

/**
 * On startup: find all 'pending' rows left by a previous crash and re-process them.
 * Call from main.js after accounts are restored.
 */
async function recoverPendingReplies() {
    try {
        const db = Database.getDb();
        const pending = db.prepare(`
            SELECT DISTINCT account_id FROM reply_queue WHERE status = 'pending'
        `).all();

        if (pending.length === 0) return;
        console.log(`[ReplyService] Recovering pending replies for ${pending.length} account(s)`);
        for (const row of pending) {
            processQueue(row.account_id, null, null).catch(() => {});
        }
    } catch (err) {
        console.error('[ReplyService] recoverPendingReplies error:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal queue processor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process reply_queue for one account sequentially until empty.
 * @param {string} accountId
 * @param {number|null} targetRowId  — if set, resolve the promise when this row completes
 * @param {Function|null} resolve    — promise resolve for the caller's queueReply() call
 */
async function processQueue(accountId, targetRowId, resolve) {
    if (processingLocks.has(accountId)) {
        // Already running for this account — the loop will pick up new rows naturally
        if (resolve) {
            // Caller is waiting — poll for their row to complete
            _waitForRow(targetRowId, resolve);
        }
        return;
    }

    processingLocks.add(accountId);
    try {
        while (true) {
            const db = Database.getDb();
            const row = db.prepare(`
                SELECT
                    rq.id,
                    rq.account_id,
                    rq.conversation_id,
                    rq.message,
                    rq.status,
                    rq.attempts,
                    rq.created_at,
                    rq.next_attempt_at,
                    rj.id AS reply_job_id,
                    rj.message_hash AS job_message_hash,
                    rj.reply_id AS job_reply_id
                FROM reply_queue rq
                LEFT JOIN reply_jobs rj ON rj.legacy_queue_id = rq.id
                WHERE rq.account_id = ? AND rq.status = 'pending' AND rq.next_attempt_at <= ?
                ORDER BY rq.id ASC LIMIT 1
            `).get(accountId, Date.now());

            if (!row) break; // Queue empty (or all items are deferred)

            db.prepare(`
                UPDATE reply_jobs
                SET status = 'in_progress', execution_started_at = ?, updated_at = ?
                WHERE legacy_queue_id = ?
            `).run(Date.now(), Date.now(), row.id);

            const attemptId = startAttempt(db, row.reply_job_id, row.job_reply_id);

            const result = await executeReply(accountId, row.conversation_id, row.message, {
                messageHash: row.job_message_hash,
            });

            if (result.success) {
                const sentHash = row.job_message_hash || sha256Utf8(row.message);
                finishAttempt(db, attemptId, 'sent', null, null, sentHash);
                db.prepare(`UPDATE reply_queue SET status = 'sent' WHERE id = ?`).run(row.id);
                db.prepare(`
                    UPDATE reply_jobs
                    SET status = 'sent', completed_at = ?, updated_at = ?, error_code = NULL
                    WHERE legacy_queue_id = ?
                `).run(Date.now(), Date.now(), row.id);
                console.log(`[ReplyService] Reply #${row.id} sent successfully`);
                if (resolve && row.id === targetRowId) {
                    resolve({ success: true });
                    resolve = null;
                }
            } else if (result.terminal) {
                finishAttempt(
                    db,
                    attemptId,
                    'dead_letter',
                    result.errorCode || 'terminal',
                    result.reason,
                    null
                );
                db.prepare(`UPDATE reply_queue SET status = 'failed', attempts = ? WHERE id = ?`).run(row.attempts + 1, row.id);
                db.prepare(`
                    UPDATE reply_jobs
                    SET status = 'dead_letter', attempts = ?, completed_at = ?, updated_at = ?, last_error = ?, error_code = ?
                    WHERE legacy_queue_id = ?
                `).run(
                    row.attempts + 1,
                    Date.now(),
                    Date.now(),
                    result.reason || 'terminal',
                    result.errorCode || 'terminal',
                    row.id
                );
                console.error(`[ReplyService] Reply #${row.id} terminal failure: ${result.reason}`);
                try {
                    NotificationOutbox.enqueue(
                        {
                            senderName: '❌ Reply Failed',
                            body: `${result.reason}\nMsg: ${row.message.substring(0, 80)}`,
                            accountId,
                            accountLabel: accountId,
                            timestamp: Date.now(),
                        },
                        null
                    );
                } catch (_) {}
                if (resolve && row.id === targetRowId) {
                    resolve({ success: false, reason: result.reason });
                    resolve = null;
                }
            } else {
                finishAttempt(db, attemptId, 'failed_retryable', null, result.reason, null);
                const newAttempts = row.attempts + 1;
                if (newAttempts >= MAX_ATTEMPTS) {
                    db.prepare(`UPDATE reply_queue SET status = 'failed', attempts = ? WHERE id = ?`).run(newAttempts, row.id);
                    db.prepare(`
                        UPDATE reply_jobs
                        SET status = 'dead_letter', attempts = ?, completed_at = ?, updated_at = ?, last_error = ?
                        WHERE legacy_queue_id = ?
                    `).run(newAttempts, Date.now(), Date.now(), result.reason || 'max-attempts-exceeded', row.id);
                    console.error(`[ReplyService] Reply #${row.id} FAILED after ${MAX_ATTEMPTS} attempts: ${result.reason}`);
                    try {
                        NotificationOutbox.enqueue(
                            {
                                senderName: '❌ Reply Failed',
                                body: `${result.reason}\nMsg: ${row.message.substring(0, 80)}`,
                                accountId,
                                accountLabel: accountId,
                                timestamp: Date.now(),
                            },
                            null
                        );
                    } catch (_) {}
                    if (resolve && row.id === targetRowId) {
                        resolve({ success: false, reason: result.reason });
                        resolve = null;
                    }
                } else {
                    const nextAttemptAt = Date.now() + RETRY_BASE_MS * newAttempts;
                    db.prepare(`UPDATE reply_queue SET attempts = ?, next_attempt_at = ? WHERE id = ?`)
                        .run(newAttempts, nextAttemptAt, row.id);
                    db.prepare(`
                        UPDATE reply_jobs
                        SET status = 'failed', attempts = ?, next_attempt_at = ?, updated_at = ?, last_error = ?
                        WHERE legacy_queue_id = ?
                    `).run(newAttempts, nextAttemptAt, Date.now(), result.reason || 'retry-scheduled', row.id);
                    console.warn(`[ReplyService] Reply #${row.id} attempt ${newAttempts} failed — retrying in ${RETRY_BASE_MS * newAttempts / 1000}s`);
                    if (resolve && row.id === targetRowId) {
                        setTimeout(() => {
                            processQueue(accountId, targetRowId, resolve).catch(() => {});
                        }, RETRY_BASE_MS * newAttempts + 500);
                        resolve = null;
                    }
                }
            }

            await sleep(MIN_REPLY_GAP_MS);
        }
    } finally {
        processingLocks.delete(accountId);
    }

    // If caller's row was never resolved (e.g. it's a deferred retry), wait for it
    if (resolve && targetRowId !== null) {
        _waitForRow(targetRowId, resolve);
    }
}

/**
 * Poll until a specific row reaches a terminal state, then resolve.
 * Used when the queue is already processing and we need to track a specific row.
 * Times out after 5 minutes to prevent an infinite loop if the row gets stuck.
 */
function _waitForRow(rowId, resolve) {
    if (!rowId || !resolve) return;
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max
    const deadline = Date.now() + TIMEOUT_MS;
    const check = () => {
        if (Date.now() >= deadline) {
            resolve({ success: false, reason: 'wait-timeout: reply did not complete within 5 minutes' });
            return;
        }
        try {
            const row = Database.getDb().prepare(`SELECT status, attempts FROM reply_queue WHERE id = ?`).get(rowId);
            if (!row || row.status === 'sent') {
                resolve({ success: true });
            } else if (row.status === 'failed') {
                resolve({ success: false, reason: 'max-attempts-exceeded' });
            } else {
                setTimeout(check, 2000); // re-check every 2s
            }
        } catch (_) {
            resolve({ success: false, reason: 'db-lookup-error' });
        }
    };
    setTimeout(check, 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core reply execution: navigate → type → send → navigate back
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ messageHash?: string | null }} [meta]
 */
async function executeReply(accountId, conversationId, message, meta) {
    const page = await PlaywrightManager.getMessengerPage(accountId);
    if (!page) {
        return { success: false, reason: `Account ${accountId} not found or page not available` };
    }

    if (!conversationId) {
        return { success: false, reason: `No conversationId provided for reply on ${accountId}` };
    }

    // Snapshot sidebar state BEFORE navigating so the monitor can reconcile
    // any messages that arrived during the reply navigation gap
    try { MessageMonitor.captureReplySnapshot(accountId); } catch (_) {}

    // Lock detection to prevent spurious notifications while we navigate.
    // IMPORTANT: every return path below MUST call unlockReply() to release this.
    try { MessageMonitor.lockReply(accountId, conversationId); } catch (_) {}

    // Helper to always release the lock regardless of how we exit
    const unlockReply = () => {
        try { MessageMonitor.markReplied(accountId, conversationId, null); } catch (_) {}
    };

    console.log(`[ReplyService] Replying on ${accountId} to conversation ${conversationId}`);

    const TEXTBOX_SELECTOR = 'div[role="textbox"][contenteditable="true"], div[aria-label="Message"][contenteditable="true"], div[aria-label="Type a message"][contenteditable="true"]';
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
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
            await sleep(2000);

            const textbox = await page.$(TEXTBOX_SELECTOR);
            if (textbox) { navigated = true; break; }

            await sleep(3000);
            const textboxRetry = await page.$(TEXTBOX_SELECTOR);
            if (textboxRetry) { navigated = true; break; }

            lastError = new Error('Textbox not found on page');
        } catch (err) {
            lastError = err;
            console.warn(`[ReplyService] Navigation failed for ${url}:`, err.message);
        }
    }

    if (!navigated) {
        const errMsg = lastError ? lastError.message : 'unknown';
        console.error(`[ReplyService] Could not load conversation: ${errMsg}`);
        unlockReply();
        await safeNavigateBack(page);
        return { success: false, reason: `navigation-failed: ${errMsg}` };
    }

    // Literal-send verification (immutable payload) — fail closed before typing
    if (meta && meta.messageHash) {
        const h = sha256Utf8(message);
        if (h !== meta.messageHash) {
            console.error(`[ReplyService] literal_hash_mismatch expected=${meta.messageHash} actual=${h}`);
            unlockReply();
            await safeNavigateBack(page);
            return {
                success: false,
                reason: 'literal_hash_mismatch',
                terminal: true,
                errorCode: 'literal_hash_mismatch',
            };
        }
    }

    // Step 2: Click textbox, paste message, and send
    try {
        const textbox = await page.$(TEXTBOX_SELECTOR);
        if (!textbox) {
            unlockReply();
            await safeNavigateBack(page);
            return { success: false, reason: 'textbox-disappeared' };
        }
        await textbox.click();
        await sleep(300);

        // Verify focus is still in the textbox before pasting
        const focused = await page.evaluate(() =>
            document.activeElement && document.activeElement.getAttribute('contenteditable') === 'true'
        );
        if (!focused) {
            await textbox.click();
            await sleep(200);
        }

        // Copy-paste: write message to clipboard, then Ctrl+V
        await page.evaluate((text) => navigator.clipboard.writeText(text), message);
        await page.keyboard.down('Control');
        await page.keyboard.press('v');
        await page.keyboard.up('Control');
        await sleep(500);

        await page.keyboard.press('Enter');
        console.log(`[ReplyService] Message sent on ${accountId} to ${conversationId}`);
        await sleep(1000);
    } catch (err) {
        console.error(`[ReplyService] Send failed:`, err.message);
        unlockReply();
        await safeNavigateBack(page);
        return { success: false, reason: `send-failed: ${err.message}` };
    }

    // Mark conversation as replied (this also releases the lock with the sent text)
    try { MessageMonitor.markReplied(accountId, conversationId, message); } catch (_) {}

    // Step 3: Navigate back to inbox so polling resumes on the sidebar
    await safeNavigateBack(page);

    return { success: true };
}

async function safeNavigateBack(page) {
    try {
        await page.goto(MESSENGER_BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
        console.error('[ReplyService] Failed to navigate back to inbox:', e.message);
        // Best-effort: try a reload to get back to a usable state
        try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }); } catch (_) {}
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = { queueReply, queueReplyFromCommand, recoverPendingReplies };
