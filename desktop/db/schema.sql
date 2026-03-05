
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
