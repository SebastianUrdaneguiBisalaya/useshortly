CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY,
    link_id INTEGER NOT NULL,
    clicked_at TEXT NOT NULL,
    referrer TEXT NOT NULL DEFAULT '' CHECK (length(referrer) <= 255),
    user_agent TEXT NOT NULL DEFAULT '' CHECK (length(user_agent) <= 512),
    country TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clicks_link_clicked_at
    ON clicks (link_id, clicked_at);
