CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE CHECK (length(email) <= 255),
    email_verified INTEGER DEFAULT 0 CHECK (email_verified IN (0, 1)),
    first_name TEXT NOT NULL CHECK (length(first_name) <= 255),
    last_name TEXT NOT NULL CHECK (length(last_name) <= 255),
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
    ON users (lower(email));

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL CHECK (provider_id IN ('GOOGLE', 'DEFAULT')),
    access_token TEXT,
    refresh_token TEXT,
    access_token_expires_at TEXT,
    refresh_token_expires_at TEXT,
    id_token TEXT,
    password TEXT,
    scope TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, account_id)
);