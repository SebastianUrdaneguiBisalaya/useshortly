CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (length(code) <= 15),
    origin_url TEXT NOT NULL CHECK (length(origin_url) <= 255),
    expires_at TEXT,
    max_clicks INTEGER CHECK (max_clicks IS NULL OR max_clicks > 0),
    click_count INTEGER NOT NULL DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    updated_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_links_org_id
    ON links (tenant_id);

CREATE INDEX IF NOT EXISTS idx_links_created_by
    ON links (created_by);

CREATE INDEX IF NOT EXISTS idx_links_updated_by
    ON links (updated_by);

CREATE INDEX IF NOT EXISTS idx_links_expires_at
    ON links (expires_at);
