-- Custom domains, owned by an organization. host is stored lowercase and unique across tenants.
CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    host TEXT NOT NULL UNIQUE CHECK (length(host) <= 253 AND host = lower(host)),
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_domains_tenant_id
    ON domains (tenant_id);

-- links gets an optional domain_id and its code stops being globally unique: it is unique per
-- domain (NULL is the default host). SQLite cannot drop the inline UNIQUE, so the table is
-- rebuilt; foreign keys are off meanwhile so dropping it does not cascade to clicks and unlock pages.
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE links_new (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL CHECK (length(code) <= 15),
    origin_url TEXT NOT NULL CHECK (length(origin_url) <= 255),
    expires_at TEXT,
    max_clicks INTEGER CHECK (max_clicks IS NULL OR max_clicks > 0),
    click_count INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    tenant_id INTEGER NOT NULL,
    domain_id INTEGER,
    created_by INTEGER NOT NULL,
    updated_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT INTO links_new (id, code, origin_url, expires_at, max_clicks, click_count, password_hash,
                       tenant_id, created_by, updated_by, created_at, updated_at)
SELECT id, code, origin_url, expires_at, max_clicks, click_count, password_hash,
       tenant_id, created_by, updated_by, created_at, updated_at
FROM links;

DROP TABLE links;
ALTER TABLE links_new RENAME TO links;

CREATE INDEX IF NOT EXISTS idx_links_org_id ON links (tenant_id);
CREATE INDEX IF NOT EXISTS idx_links_created_by ON links (created_by);
CREATE INDEX IF NOT EXISTS idx_links_updated_by ON links (updated_by);
CREATE INDEX IF NOT EXISTS idx_links_expires_at ON links (expires_at);
CREATE INDEX IF NOT EXISTS idx_links_domain_id ON links (domain_id);

-- One code per domain; a NULL domain_id counts as 0 so the default host is unique too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_domain_code ON links (COALESCE(domain_id, 0), code);
COMMIT;
PRAGMA foreign_keys = ON;
