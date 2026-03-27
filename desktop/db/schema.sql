
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    nickname    TEXT NOT NULL,
    fb_user_id  TEXT,
    fb_name     TEXT,
    profile_dir TEXT NOT NULL,
    status      TEXT DEFAULT 'offline',
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL,
    participant_name TEXT,
    last_message    TEXT,
    last_message_at INTEGER,
    unread_count    INTEGER DEFAULT 0,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
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

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS reply_context (
    telegram_msg_id  INTEGER PRIMARY KEY,
    account_id       TEXT NOT NULL,
    conversation_id  TEXT NOT NULL,
    sender_name      TEXT,
    created_at       INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reply_context_created ON reply_context(created_at);

-- ── Performance indexes (added Phase 2 scaling) ─────────────────────────────
-- notifications:get sorts all incoming messages by time — essential at 100k+ rows
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
-- Per-account inbox query + outgoing filter
CREATE INDEX IF NOT EXISTS idx_messages_account_outgoing ON messages(account_id, is_outgoing);
-- Conversations list ordered by most recent activity
CREATE INDEX IF NOT EXISTS idx_conversations_account_time ON conversations(account_id, last_message_at DESC);

-- ── Persistent reply queue (Phase 4 scaling) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message         TEXT NOT NULL,
    status          TEXT DEFAULT 'pending',  -- pending | sent | failed
    attempts        INTEGER DEFAULT 0,
    created_at      INTEGER NOT NULL,
    next_attempt_at INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reply_queue_pending ON reply_queue(status, next_attempt_at);

-- ── Durable pipeline tables (phased migration) ──────────────────────────────

-- Immutable inbound detection events (one logical event across multiple detectors)
CREATE TABLE IF NOT EXISTS inbound_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key        TEXT NOT NULL UNIQUE,
    account_id       TEXT NOT NULL,
    conversation_id  TEXT,
    sender_name      TEXT,
    body             TEXT,
    detected_by      TEXT NOT NULL,
    status           TEXT DEFAULT 'new',  -- new | stored | routed | notified | failed
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER,
    error_reason     TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inbound_events_status_time ON inbound_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_inbound_events_account_time ON inbound_events(account_id, created_at DESC);

-- Telegram notification outbox for crash-safe retries
CREATE TABLE IF NOT EXISTS notification_outbox (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    inbound_event_id   INTEGER,
    account_id         TEXT NOT NULL,
    conversation_id    TEXT,
    sender_name        TEXT,
    body               TEXT NOT NULL,
    payload_text       TEXT,
    context_json       TEXT,
    status             TEXT DEFAULT 'pending',  -- pending | sending | sent | failed | dead_letter
    attempts           INTEGER DEFAULT 0,
    next_attempt_at    INTEGER,
    telegram_msg_id    INTEGER,
    last_error         TEXT,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER,
    sent_at            INTEGER,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (inbound_event_id) REFERENCES inbound_events(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending ON notification_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_account_time ON notification_outbox(account_id, created_at DESC);

-- Durable reply jobs (new worker path; legacy reply_queue remains during migration)
CREATE TABLE IF NOT EXISTS reply_jobs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_queue_id       INTEGER,
    account_id            TEXT NOT NULL,
    conversation_id       TEXT NOT NULL,
    message_text          TEXT NOT NULL,
    source                TEXT DEFAULT 'telegram',  -- telegram | manual | replay
    status                TEXT DEFAULT 'queued',    -- queued | in_progress | sent | failed | dead_letter
    attempts              INTEGER DEFAULT 0,
    max_attempts          INTEGER DEFAULT 3,
    next_attempt_at       INTEGER,
    execution_started_at  INTEGER,
    completed_at          INTEGER,
    last_error            TEXT,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reply_jobs_pending ON reply_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_reply_jobs_account_time ON reply_jobs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reply_jobs_legacy_queue ON reply_jobs(legacy_queue_id);

-- Terminal failures for replay/inspection
CREATE TABLE IF NOT EXISTS dead_letters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_table    TEXT NOT NULL,   -- inbound_events | notification_outbox | reply_jobs
    source_id       INTEGER NOT NULL,
    account_id      TEXT,
    payload_json    TEXT,
    final_error     TEXT,
    attempts        INTEGER,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dead_letters_table_id ON dead_letters(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_dead_letters_account_time ON dead_letters(account_id, created_at DESC);
