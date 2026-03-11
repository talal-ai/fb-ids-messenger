
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

    // Load schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
        console.log('[DB] Schema applied');
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

    return db;
}

function getDb() {
    if (!db) return initDatabase();
    return db;
}

module.exports = { initDatabase, getDb };
