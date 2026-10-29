-- Campaigns group an organization's links by marketing initiative; channels are where a campaign's
-- links are shared (Instagram, email...). A link in a channel gets utm_source (the channel),
-- utm_campaign (the campaign) and utm_medium=useshortly added to its destination.
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- A campaign name is unique per organization, ignoring case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_tenant_name
    ON campaigns (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- A channel name is unique inside its campaign, ignoring case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_campaign_name
    ON channels (campaign_id, lower(name));

-- The channel a link was shared in; NULL for a link outside every campaign. It is a plain column
-- (SQLite cannot drop a column that has a foreign key, which would make the down migration a
-- table rebuild), so the trigger below does what ON DELETE SET NULL would.
ALTER TABLE links ADD COLUMN channel_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_links_channel_id
    ON links (channel_id);

CREATE TRIGGER IF NOT EXISTS trg_channels_detach_links
BEFORE DELETE ON channels
BEGIN
    UPDATE links SET channel_id = NULL WHERE channel_id = OLD.id;
END;
