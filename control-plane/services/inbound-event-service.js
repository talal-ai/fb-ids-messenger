const { validate } = require('../validation/contract-validator');
const { computeInboundEventHash } = require('../lib/hashes');

function mapAjvErrors(errors) {
    return (errors || []).map((e) => ({
        path: e.instancePath || e.schemaPath || '',
        message: e.message || String(e),
    }));
}

/**
 * Validate and persist an inbound event (HTTP ingest). Verifies event_hash matches canonical computation.
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} payload
 * @returns {{ ok: true, inbound_event_id: number } | { ok: false, code: string, detail?: string, errors?: unknown[] }}
 */
function acceptInboundEvent(db, payload) {
    const v = validate('InboundEvent', payload);
    if (!v.ok) {
        return { ok: false, code: 'validation_error', errors: mapAjvErrors(v.errors) };
    }

    const p = payload;
    const expectedHash = computeInboundEventHash({
        account_id: p.account_id,
        conversation_id: p.conversation_id,
        sender_name: p.sender_name,
        body_raw: p.body_raw,
        detected_at: p.detected_at,
        detector_source: p.detector_source,
    });
    if (expectedHash !== p.event_hash) {
        return { ok: false, code: 'validation_error', detail: 'event_hash mismatch for payload fields' };
    }

    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(p.account_id);
    if (!account) {
        return { ok: false, code: 'validation_error', detail: `unknown account_id: ${p.account_id}` };
    }

    const eventKey = expectedHash;

    try {
        const tx = db.transaction(() => {
            const existing = db.prepare('SELECT id FROM inbound_events WHERE event_key = ?').get(eventKey);
            if (existing) {
                return { duplicate: true, id: existing.id };
            }

            const ins = db
                .prepare(
                    `INSERT INTO inbound_events
                        (event_key, event_id, event_hash, account_id, conversation_id, sender_name, body, detected_by, status, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stored', ?, ?)`
                )
                .run(
                    eventKey,
                    p.event_id,
                    p.event_hash,
                    p.account_id,
                    p.conversation_id,
                    p.sender_name,
                    p.body_raw,
                    p.detector_source,
                    p.detected_at,
                    Date.now()
                );

            const inboundEventId = Number(ins.lastInsertRowid);

            db.prepare(
                `INSERT INTO conversations (id, account_id, participant_name, last_message, last_message_at, unread_count)
                 VALUES (?, ?, ?, ?, ?, 1)
                 ON CONFLICT(id) DO UPDATE SET
                    participant_name = COALESCE(excluded.participant_name, participant_name),
                    last_message = excluded.last_message,
                    last_message_at = excluded.last_message_at,
                    unread_count = unread_count + 1`
            ).run(p.conversation_id, p.account_id, p.sender_name, p.body_raw, p.detected_at);

            const msgId = `msg_${p.conversation_id}_${p.detected_at}_${Math.random().toString(36).substring(2, 8)}`;
            db.prepare(
                `INSERT INTO messages (id, conversation_id, account_id, sender_name, body, timestamp, is_outgoing)
                 VALUES (?, ?, ?, ?, ?, ?, 0)
                 ON CONFLICT(id) DO NOTHING`
            ).run(msgId, p.conversation_id, p.account_id, p.sender_name, p.body_raw, p.detected_at);

            return { duplicate: false, id: inboundEventId };
        });

        const result = tx();
        return { ok: true, inbound_event_id: result.id, duplicate: result.duplicate };
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (msg.includes('UNIQUE') || msg.includes('unique')) {
            return { ok: false, code: 'validation_error', detail: 'duplicate event_id or event_key' };
        }
        return { ok: false, code: 'validation_error', detail: msg };
    }
}

module.exports = { acceptInboundEvent };
