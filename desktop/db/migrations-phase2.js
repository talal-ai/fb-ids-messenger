/**
 * Phase 2 control-plane: canonical IDs, idempotency, message hash, reply_attempts ledger.
 * Applied after schema.sql on both fresh installs and upgrades.
 */

function columnNames(db, table) {
    try {
        return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    } catch {
        return [];
    }
}

function applyPhase2Migrations(db) {
    // inbound_events: canonical contract fields
    try {
        const cols = columnNames(db, 'inbound_events');
        if (cols.length > 0) {
            if (!cols.includes('event_id')) {
                db.exec('ALTER TABLE inbound_events ADD COLUMN event_id TEXT');
                console.log('[DB] Migration phase2: inbound_events.event_id');
            }
            if (!cols.includes('event_hash')) {
                db.exec('ALTER TABLE inbound_events ADD COLUMN event_hash TEXT');
                console.log('[DB] Migration phase2: inbound_events.event_hash');
            }
        }
    } catch (e) {
        console.error('[DB] Migration phase2 inbound_events:', e.message);
    }

    try {
        db.exec(
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_events_event_id ON inbound_events(event_id) WHERE event_id IS NOT NULL AND event_id != \'\''
        );
    } catch (e) {
        console.error('[DB] Migration phase2 idx inbound event_id:', e.message);
    }

    // reply_jobs: canonical reply command + literal hash
    try {
        const cols = columnNames(db, 'reply_jobs');
        if (cols.length > 0) {
            if (!cols.includes('reply_id')) {
                db.exec('ALTER TABLE reply_jobs ADD COLUMN reply_id TEXT');
                console.log('[DB] Migration phase2: reply_jobs.reply_id');
            }
            if (!cols.includes('idempotency_key')) {
                db.exec('ALTER TABLE reply_jobs ADD COLUMN idempotency_key TEXT');
                console.log('[DB] Migration phase2: reply_jobs.idempotency_key');
            }
            if (!cols.includes('event_id')) {
                db.exec('ALTER TABLE reply_jobs ADD COLUMN event_id TEXT');
                console.log('[DB] Migration phase2: reply_jobs.event_id');
            }
            if (!cols.includes('message_hash')) {
                db.exec('ALTER TABLE reply_jobs ADD COLUMN message_hash TEXT');
                console.log('[DB] Migration phase2: reply_jobs.message_hash');
            }
            if (!cols.includes('expected_conversation_version')) {
                db.exec('ALTER TABLE reply_jobs ADD COLUMN expected_conversation_version INTEGER');
                console.log('[DB] Migration phase2: reply_jobs.expected_conversation_version');
            }
            if (!cols.includes('error_code')) {
                db.exec('ALTER TABLE reply_jobs ADD COLUMN error_code TEXT');
                console.log('[DB] Migration phase2: reply_jobs.error_code');
            }
        }
    } catch (e) {
        console.error('[DB] Migration phase2 reply_jobs:', e.message);
    }

    try {
        db.exec(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_jobs_idempotency ON reply_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != ''"
        );
        db.exec(
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_jobs_reply_id ON reply_jobs(reply_id) WHERE reply_id IS NOT NULL AND reply_id != \'\''
        );
    } catch (e) {
        console.error('[DB] Migration phase2 reply_jobs indexes:', e.message);
    }

    // reply_attempts ledger (append-style execution history)
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS reply_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                attempt_id TEXT NOT NULL UNIQUE,
                reply_job_id INTEGER NOT NULL,
                reply_id TEXT,
                worker_id TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                status TEXT NOT NULL,
                error_code TEXT,
                error_detail TEXT,
                sent_hash TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (reply_job_id) REFERENCES reply_jobs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_reply_attempts_job ON reply_attempts(reply_job_id);
            CREATE INDEX IF NOT EXISTS idx_reply_attempts_reply_id ON reply_attempts(reply_id);
        `);
        console.log('[DB] Migration phase2: reply_attempts table ensured');
    } catch (e) {
        console.error('[DB] Migration phase2 reply_attempts:', e.message);
    }

    try {
        const v = db.pragma('user_version', { simple: true }) || 0;
        if (v < 3) {
            db.pragma('user_version = 3');
            console.log('[DB] Schema user_version set to 3 (phase2 control-plane)');
        }
    } catch (e) {
        console.error('[DB] user_version phase2:', e.message);
    }

    // ── Phase 3: device_tokens for Expo push notifications ──────────────
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS device_tokens (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                token      TEXT UNIQUE NOT NULL,
                platform   TEXT DEFAULT 'ios',
                label      TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
        console.log('[DB] Migration phase3: device_tokens table ensured');
    } catch (e) {
        console.error('[DB] Migration phase3 device_tokens:', e.message);
    }

    try {
        const v = db.pragma('user_version', { simple: true }) || 0;
        if (v < 4) {
            db.pragma('user_version = 4');
            console.log('[DB] Schema user_version set to 4 (phase3 mobile-push)');
        }
    } catch (e) {
        console.error('[DB] user_version phase3:', e.message);
    }
}

module.exports = { applyPhase2Migrations };
