CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    name TEXT NOT NULL CHECK (length(name) <= 100),
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
    last_used_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id
    ON api_keys (tenant_id);
