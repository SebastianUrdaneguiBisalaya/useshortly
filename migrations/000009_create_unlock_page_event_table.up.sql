-- Who changed an unlock page and when. Rows outlive the page (and the link) they describe, so there
-- is no foreign key to them; they go with their organization.
CREATE TABLE IF NOT EXISTS unlock_page_events (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    link_id INTEGER,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('set', 'delete')),
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_unlock_page_events_tenant
    ON unlock_page_events (tenant_id, id);
