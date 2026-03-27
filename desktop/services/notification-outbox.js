const Database = require('../db/database');

const TICK_MS = 600;
const MAX_ATTEMPTS = 5;

class NotificationOutbox {
    constructor() {
        this._timer = null;
        this._sender = null;
        this._running = false;
    }

    /**
     * Set sender callback used by worker.
     * Signature: async (notifData, context) => sentMsg | null
     */
    setSender(senderFn) {
        this._sender = senderFn;
    }

    start() {
        if (this._timer) return;
        this._timer = setInterval(() => {
            this._drainOne().catch(() => {});
        }, TICK_MS);
        console.log('[Outbox] Started');
    }

    stop() {
        if (!this._timer) return;
        clearInterval(this._timer);
        this._timer = null;
        console.log('[Outbox] Stopped');
    }

    enqueue(notifData, context, options = null) {
        const db = Database.getDb();
        const now = Date.now();
        const payloadText = JSON.stringify(notifData || {});
        const contextJson = context ? JSON.stringify(context) : null;
        const inboundEventId = options && options.inboundEventId ? Number(options.inboundEventId) : null;

        const senderName = (notifData && notifData.senderName) || null;
        const body = (notifData && notifData.body) || '';
        const accountId = (notifData && notifData.accountId) || (context && context.accountId) || '';
        const conversationId = (context && context.conversationId) || null;

        const result = db.prepare(`
            INSERT INTO notification_outbox
                (inbound_event_id, account_id, conversation_id, sender_name, body, payload_text, context_json,
                 status, attempts, next_attempt_at, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
        `).run(inboundEventId, accountId, conversationId, senderName, body, payloadText, contextJson, now, now, now);

        return result.lastInsertRowid;
    }

    async _drainOne() {
        if (this._running) return;
        this._running = true;
        try {
            if (!this._sender) return;
            const db = Database.getDb();
            const now = Date.now();

            const row = db.prepare(`
                SELECT *
                FROM notification_outbox
                WHERE status IN ('pending', 'failed')
                  AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                ORDER BY created_at ASC
                LIMIT 1
            `).get(now);

            if (!row) return;

            // Move to sending state
            const claimed = db.prepare(`
                UPDATE notification_outbox
                SET status = 'sending', updated_at = ?
                WHERE id = ? AND status IN ('pending', 'failed')
            `).run(now, row.id);

            if (!claimed.changes) return;

            let notifData;
            let context;
            try {
                notifData = row.payload_text ? JSON.parse(row.payload_text) : {};
            } catch (_) {
                notifData = { senderName: row.sender_name, body: row.body, accountId: row.account_id };
            }
            try {
                context = row.context_json ? JSON.parse(row.context_json) : null;
            } catch (_) {
                context = null;
            }

            try {
                const sentMsg = await this._sender(notifData, context);
                db.prepare(`
                    UPDATE notification_outbox
                    SET status = 'sent',
                        telegram_msg_id = ?,
                        sent_at = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(sentMsg && sentMsg.message_id ? sentMsg.message_id : null, Date.now(), Date.now(), row.id);

                if (row.inbound_event_id) {
                    db.prepare(`
                        UPDATE inbound_events
                        SET status = 'notified', updated_at = ?
                        WHERE id = ?
                    `).run(Date.now(), row.inbound_event_id);
                }
            } catch (err) {
                const attempts = (row.attempts || 0) + 1;
                if (attempts >= MAX_ATTEMPTS) {
                    db.prepare(`
                        UPDATE notification_outbox
                        SET status = 'dead_letter',
                            attempts = ?,
                            last_error = ?,
                            updated_at = ?
                        WHERE id = ?
                    `).run(attempts, err && err.message ? err.message : 'unknown-send-error', Date.now(), row.id);

                    db.prepare(`
                        INSERT INTO dead_letters (source_table, source_id, account_id, payload_json, final_error, attempts, created_at)
                        VALUES ('notification_outbox', ?, ?, ?, ?, ?, ?)
                    `).run(row.id, row.account_id || null, row.payload_text || '{}', err && err.message ? err.message : 'unknown-send-error', attempts, Date.now());

                    if (row.inbound_event_id) {
                        db.prepare(`
                            UPDATE inbound_events
                            SET status = 'failed', updated_at = ?, error_reason = ?
                            WHERE id = ?
                        `).run(Date.now(), err && err.message ? err.message : 'outbox-dead-letter', row.inbound_event_id);
                    }
                } else {
                    const nextAttemptAt = Date.now() + (attempts * 2000);
                    db.prepare(`
                        UPDATE notification_outbox
                        SET status = 'failed',
                            attempts = ?,
                            next_attempt_at = ?,
                            last_error = ?,
                            updated_at = ?
                        WHERE id = ?
                    `).run(attempts, nextAttemptAt, err && err.message ? err.message : 'unknown-send-error', Date.now(), row.id);
                }
            }
        } finally {
            this._running = false;
        }
    }
}

module.exports = new NotificationOutbox();
