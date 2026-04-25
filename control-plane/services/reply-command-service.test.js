const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applyPhase2Migrations } = require('../../desktop/db/migrations-phase2');
const { acceptReplyCommand } = require('./reply-command-service');
const { sha256Utf8 } = require('../lib/hashes');

const MAX_ATTEMPTS = 3;

function createMemoryDb() {
    const db = new Database(':memory:');
    const schemaPath = path.join(__dirname, '..', '..', 'desktop', 'db', 'schema.sql');
    db.exec(fs.readFileSync(schemaPath, 'utf8'));
    applyPhase2Migrations(db);
    db.prepare(
        'INSERT INTO accounts (id, nickname, profile_dir, status, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('acc_test_1', 't', 'acc_test_1', 'active', Date.now());
    return db;
}

/** Minimal dual-write to mirror reply-service queue path (for tests only). */
function mockQueueWriter(db, payload, opts) {
    const now = Date.now();
    const mh = opts.messageHash;
    const ins = db
        .prepare(
            `INSERT INTO reply_queue (account_id, conversation_id, message, status, attempts, created_at, next_attempt_at)
             VALUES (?, ?, ?, 'pending', 0, ?, ?)`
        )
        .run(payload.account_id, payload.conversation_id, payload.message_raw, now, now);
    const qid = Number(ins.lastInsertRowid);
    db.prepare(
        `INSERT INTO reply_jobs
            (legacy_queue_id, reply_id, idempotency_key, event_id, message_hash, expected_conversation_version,
             account_id, conversation_id, message_text, source, status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api', 'queued', 0, ?, ?, ?, ?)`
    ).run(
        qid,
        payload.reply_id,
        payload.idempotency_key,
        payload.event_id,
        mh,
        payload.expected_conversation_version,
        payload.account_id,
        payload.conversation_id,
        payload.message_raw,
        MAX_ATTEMPTS,
        now,
        now,
        now
    );
    return { success: true };
}

describe('acceptReplyCommand idempotency', () => {
    test('duplicate same payload returns duplicate', async () => {
        const db = createMemoryDb();
        const payload = {
            reply_id: 'rpl_dup_1xxxxxxxx',
            idempotency_key: 'idem_same',
            event_id: 'evt_1xxxxxxxxx',
            account_id: 'acc_test_1',
            conversation_id: 'conv_1',
            message_raw: 'hello',
            expected_conversation_version: null,
            created_at: Date.now(),
        };
        const queue = jest.fn(async (opts) => {
            expect(opts.messageHash).toBe(sha256Utf8('hello'));
            return mockQueueWriter(db, payload, opts);
        });
        const r1 = await acceptReplyCommand(db, payload, queue);
        expect(r1.ok).toBe(true);
        expect(r1.duplicate).toBe(false);
        expect(queue).toHaveBeenCalledTimes(1);

        const r2 = await acceptReplyCommand(db, payload, async () => {
            throw new Error('should not queue');
        });
        expect(r2.ok).toBe(true);
        expect(r2.duplicate).toBe(true);
        expect(r2.reply_id).toBe('rpl_dup_1xxxxxxxx');
    });

    test('same idempotency key different message conflicts', async () => {
        const db = createMemoryDb();
        const base = {
            reply_id: 'rpl_dup_2xxxxxxxx',
            idempotency_key: 'idem_conflict',
            event_id: 'evt_1xxxxxxxxx',
            account_id: 'acc_test_1',
            conversation_id: 'conv_1',
            message_raw: 'hello',
            expected_conversation_version: null,
            created_at: Date.now(),
        };
        await acceptReplyCommand(db, base, async (opts) => mockQueueWriter(db, base, opts));
        const r2 = await acceptReplyCommand(
            db,
            { ...base, message_raw: 'other' },
            async () => ({ success: true })
        );
        expect(r2.ok).toBe(false);
        expect(r2.code).toBe('idempotency_conflict');
    });
});
