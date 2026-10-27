-- Restores the global UNIQUE code. Fails if two domains already share a code.
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE links_old (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (length(code) <= 15),
    origin_url TEXT NOT NULL CHECK (length(origin_url) <= 255),
    expires_at TEXT,
    max_clicks INTEGER CHECK (max_clicks IS NULL OR max_clicks > 0),
    click_count INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    updated_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT INTO links_old (id, code, origin_url, expires_at, max_clicks, click_count, password_hash,
                       tenant_id, created_by, updated_by, created_at, updated_at)
SELECT id, code, origin_url, expires_at, max_clicks, click_count, password_hash,
       tenant_id, created_by, updated_by, created_at, updated_at
FROM links;

DROP TABLE links;
ALTER TABLE links_old RENAME TO links;

CREATE INDEX IF NOT EXISTS idx_links_org_id ON links (tenant_id);
CREATE INDEX IF NOT EXISTS idx_links_created_by ON links (created_by);
CREATE INDEX IF NOT EXISTS idx_links_updated_by ON links (updated_by);
CREATE INDEX IF NOT EXISTS idx_links_expires_at ON links (expires_at);


DROP INDEX IF EXISTS idx_domains_tenant_id;
DROP TABLE IF EXISTS domains;
COMMIT;
PRAGMA foreign_keys = ON;
