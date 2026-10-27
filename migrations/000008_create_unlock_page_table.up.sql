-- The page shown for password-protected links. link_id NULL is the organization's page for all
-- its links; otherwise it is the page of that one link, which wins over the organization's.
CREATE TABLE IF NOT EXISTS unlock_pages (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    link_id INTEGER,
    html TEXT NOT NULL CHECK (length(html) > 0 AND length(CAST(html AS BLOB)) <= 65536),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

-- One page per organization and per link; a NULL link_id counts as 0 so the organization's page is unique too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unlock_pages_scope
    ON unlock_pages (tenant_id, COALESCE(link_id, 0));
