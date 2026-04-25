const { validate } = require('../validation/contract-validator');
const { sha256Utf8 } = require('../lib/hashes');

function mapAjvErrors(errors) {
    return (errors || []).map((e) => ({
        path: e.instancePath || e.schemaPath || '',
        message: e.message || String(e),
    }));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} payload
 * @param {(opts: Record<string, unknown>) => Promise<Record<string, unknown>>} queueReplyFromCommand
 */
async function acceptReplyCommand(db, payload, queueReplyFromCommand) {
    const v = validate('ReplyCommand', payload);
    if (!v.ok) {
        return { ok: false, code: 'validation_error', errors: mapAjvErrors(v.errors) };
    }

    const p = payload;
    const messageHash = sha256Utf8(p.message_raw);

    const pre = db.transaction(() => {
        const existing = db.prepare('SELECT * FROM reply_jobs WHERE idempotency_key = ?').get(p.idempotency_key);
        if (existing) {
            const same =
                existing.account_id === p.account_id &&
                existing.conversation_id === p.conversation_id &&
                (existing.event_id || '') === (p.event_id || '') &&
                existing.message_text === p.message_raw &&
                (existing.message_hash || '') === messageHash;
            if (same) {
                return { kind: 'dup', row: existing };
            }
            return { kind: 'conflict' };
        }

        const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(p.account_id);
        if (!account) {
            return { kind: 'bad_account' };
        }

        return { kind: 'proceed', messageHash };
    })();

    if (pre.kind === 'conflict') {
        return { ok: false, code: 'idempotency_conflict' };
    }
    if (pre.kind === 'bad_account') {
        return { ok: false, code: 'validation_error', detail: `unknown account_id: ${p.account_id}` };
    }
    if (pre.kind === 'dup') {
        return {
            ok: true,
            duplicate: true,
            reply_id: pre.row.reply_id,
            reply_job_id: pre.row.id,
        };
    }

    try {
        const out = await queueReplyFromCommand({
            replyId: p.reply_id,
            idempotencyKey: p.idempotency_key,
            eventId: p.event_id,
            accountId: p.account_id,
            conversationId: p.conversation_id,
            messageRaw: p.message_raw,
            messageHash: pre.messageHash,
            expectedConversationVersion: p.expected_conversation_version,
            createdAt: p.created_at,
        });
        if (out && out.ok === false) {
            return out;
        }
        return {
            ok: true,
            duplicate: false,
            reply_id: p.reply_id,
            reply_job_id: out && out.reply_job_id,
            legacy_queue_id: out && out.legacy_queue_id,
        };
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return { ok: false, code: 'validation_error', detail: msg };
    }
}

module.exports = { acceptReplyCommand };
