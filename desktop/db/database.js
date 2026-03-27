
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db;

function initDatabase() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'messenger.db');

    console.log('[DB] Connecting to SQLite at:', dbPath);
    db = new Database(dbPath);
    
    // WAL mode for better read/write concurrency (essential with 50 accounts)
    db.pragma('journal_mode = WAL');
    // Without this, ON DELETE CASCADE in schema is silently ignored
    db.pragma('foreign_keys = ON');
    // Wait up to 5s instead of immediately failing when DB is locked
    // Prevents 'database is locked' errors when many accounts write simultaneously
    db.pragma('busy_timeout = 5000');
    // Better write throughput under concurrent worker updates
    db.pragma('synchronous = NORMAL');

    // Load schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
        console.log('[DB] Schema applied');
    }

    // Schema versioning for additive phased migrations
    try {
        const v = db.pragma('user_version', { simple: true }) || 0;
        if (v < 2) {
            db.pragma('user_version = 2');
            console.log('[DB] Schema user_version set to 2 (durable pipeline tables)');
        }
    } catch (e) {
        console.error('[DB] Failed to update schema version:', e.message);
    }

    // Migrations: add columns if missing
    try {
        const cols = db.prepare("PRAGMA table_info(accounts)").all().map(c => c.name);
        if (!cols.includes('fb_name')) {
            db.exec('ALTER TABLE accounts ADD COLUMN fb_name TEXT');
            console.log('[DB] Migration: added fb_name column');
        }
        if (!cols.includes('fb_user_id')) {
            db.exec('ALTER TABLE accounts ADD COLUMN fb_user_id TEXT');
            console.log('[DB] Migration: added fb_user_id column');
        }
    } catch (e) {
        console.error('[DB] Migration error:', e);
    }

    // Migration: ensure durable outbox has context_json for retry-safe routing.
    try {
        const outboxCols = db.prepare("PRAGMA table_info(notification_outbox)").all().map(c => c.name);
        if (outboxCols.length > 0 && !outboxCols.includes('context_json')) {
            db.exec('ALTER TABLE notification_outbox ADD COLUMN context_json TEXT');
            console.log('[DB] Migration: added notification_outbox.context_json');
        }
    } catch (e) {
        // Table may not exist on very old installs before schema apply
    }

    // Migration: ensure reply_jobs has legacy_queue_id for dual-write status sync.
    try {
        const replyJobCols = db.prepare("PRAGMA table_info(reply_jobs)").all().map(c => c.name);
        if (replyJobCols.length > 0 && !replyJobCols.includes('legacy_queue_id')) {
            db.exec('ALTER TABLE reply_jobs ADD COLUMN legacy_queue_id INTEGER');
            console.log('[DB] Migration: added reply_jobs.legacy_queue_id');
        }
    } catch (e) {
        // Table may not exist before schema apply
    }

    // Migration: rebuild messages table to add ON DELETE CASCADE on account_id.
    // SQLite doesn't support ALTER TABLE to change constraints, so we recreate it.
    // Uses PRAGMA legacy_alter_table to safely rename/recreate without FK violations.
    try {
        const fkList = db.prepare("PRAGMA foreign_key_list(messages)").all();
        const hasAccountCascade = fkList.some(
            fk => fk.table === 'accounts' && fk.on_delete === 'CASCADE'
        );
        if (!hasAccountCascade) {
            console.log('[DB] Migration: rebuilding messages table to add full CASCADE...');
            db.pragma('foreign_keys = OFF');
            db.exec(`
                BEGIN;
                ALTER TABLE messages RENAME TO _messages_old;
                CREATE TABLE messages (
                    id              TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    account_id      TEXT NOT NULL,
                    sender_name     TEXT,
                    body            TEXT,
                    timestamp       INTEGER NOT NULL,
                    is_outgoing     INTEGER DEFAULT 0,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
                );
                INSERT INTO messages SELECT * FROM _messages_old;
                DROP TABLE _messages_old;
                COMMIT;
            `);
            db.pragma('foreign_keys = ON');
            console.log('[DB] Migration: messages table rebuilt successfully');
        }
    } catch (e) {
        console.error('[DB] Migration (messages cascade) error:', e);
        db.pragma('foreign_keys = ON'); // re-enable even on failure
    }

    // Migration: create reply_context table for persisting Telegram reply routing
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS reply_context (
                telegram_msg_id INTEGER PRIMARY KEY,
                account_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                sender_name TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_reply_context_created ON reply_context(created_at);
        `);
    } catch (e) { /* table already exists — ignore */ }

    // Cleanup: purge reply contexts older than 30 days
    try {
        const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const cleaned = db.prepare('DELETE FROM reply_context WHERE created_at < ?').run(cutoff);
        if (cleaned.changes > 0) console.log(`[DB] Cleaned ${cleaned.changes} old reply context(s)`);
    } catch (e) { /* ignore */ }

    // Cleanup: purge sent/failed reply queue rows older than 7 days (keep pending forever)
    try {
        const queueCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const qCleaned = db.prepare("DELETE FROM reply_queue WHERE status != 'pending' AND created_at < ?").run(queueCutoff);
        if (qCleaned.changes > 0) console.log(`[DB] Cleaned ${qCleaned.changes} old reply queue record(s)`);
    } catch (e) { /* reply_queue may not exist on first boot before schema runs — ignore */ }

    // Cleanup: keep inbound/outbox/reply_jobs lean by deleting old terminal rows.
    // Pending/active rows are never touched.
    try {
        const old14d = Date.now() - (14 * 24 * 60 * 60 * 1000);
        const old30d = Date.now() - (30 * 24 * 60 * 60 * 1000);

        const inboundCleaned = db.prepare(
            "DELETE FROM inbound_events WHERE status IN ('notified', 'failed') AND created_at < ?"
        ).run(old14d);

        const outboxCleaned = db.prepare(
            "DELETE FROM notification_outbox WHERE status IN ('sent', 'dead_letter') AND created_at < ?"
        ).run(old14d);

        const replyJobsCleaned = db.prepare(
            "DELETE FROM reply_jobs WHERE status IN ('sent', 'dead_letter') AND created_at < ?"
        ).run(old14d);

        const deadLettersCleaned = db.prepare(
            'DELETE FROM dead_letters WHERE created_at < ?'
        ).run(old30d);

        const totalCleaned =
            (inboundCleaned.changes || 0) +
            (outboxCleaned.changes || 0) +
            (replyJobsCleaned.changes || 0) +
            (deadLettersCleaned.changes || 0);

        if (totalCleaned > 0) {
            console.log(`[DB] Cleaned ${totalCleaned} old durable-pipeline record(s)`);
        }
    } catch (e) {
        // New tables may not exist on some older installs until first schema apply
    }

    return db;
}

function getDb() {
    if (!db) return initDatabase();
    return db;
}

module.exports = { initDatabase, getDb };
