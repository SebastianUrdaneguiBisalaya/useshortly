-- Deleting organizations and accounts.
-- 1. organizations.deleted_at hides an organization at once; a background purger then deletes its
--    links and clicks in batches (a single cascading DELETE would hold SQLite's only connection).
-- 2. links.created_by and links.updated_by become nullable and are set to NULL when their user is
--    deleted, so the links of an organization outlive a member who leaves.
-- 3. The ACCOUNT_DELETION email template (the code that confirms deleting an account).
-- Tables are rebuilt because SQLite cannot alter constraints; foreign keys are off meanwhile so
-- dropping them does not cascade to clicks, unlock pages and email logs.
PRAGMA foreign_keys = OFF;
BEGIN;

ALTER TABLE organizations ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_organizations_deleted_at
    ON organizations (deleted_at) WHERE deleted_at IS NOT NULL;

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
    created_by INTEGER,
    updated_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO links_new (id, code, origin_url, expires_at, max_clicks, click_count, password_hash,
                       tenant_id, domain_id, created_by, updated_by, created_at, updated_at)
SELECT id, code, origin_url, expires_at, max_clicks, click_count, password_hash,
       tenant_id, domain_id, created_by, updated_by, created_at, updated_at
FROM links;

DROP TABLE links;
ALTER TABLE links_new RENAME TO links;

CREATE INDEX IF NOT EXISTS idx_links_org_id ON links (tenant_id);
CREATE INDEX IF NOT EXISTS idx_links_created_by ON links (created_by);
CREATE INDEX IF NOT EXISTS idx_links_updated_by ON links (updated_by);
CREATE INDEX IF NOT EXISTS idx_links_expires_at ON links (expires_at);
CREATE INDEX IF NOT EXISTS idx_links_domain_id ON links (domain_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_domain_code ON links (COALESCE(domain_id, 0), code);

CREATE TABLE email_templates_new (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (code IN ('WELCOME', 'LOGIN', 'INVITATION', 'PASSWORD_RESET', 'VERIFY_EMAIL', 'ACCOUNT_DELETION')),
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT
);

INSERT INTO email_templates_new (id, code, subject, body_html, body_text, created_at, updated_at)
SELECT id, code, subject, body_html, body_text, created_at, updated_at FROM email_templates;

DROP TABLE email_templates;
ALTER TABLE email_templates_new RENAME TO email_templates;

INSERT OR IGNORE INTO email_templates (code, subject, body_html, body_text) VALUES
(
    'ACCOUNT_DELETION',
    'Confirm deleting your useshortly account',
    '<p>Hi {{.FirstName}},</p><p>Someone asked to delete your useshortly account, with every organization you own and their links. The confirmation code is:</p><p style="font-size:24px;letter-spacing:4px"><strong>{{.Code}}</strong></p><p>It expires in {{.ExpiresInMinutes}} minutes and can be tried {{.MaxAttempts}} times. Deleting cannot be undone. If this was not you, ignore this email and change your password.</p>',
    'Hi {{.FirstName}}, someone asked to delete your useshortly account, with every organization you own and their links. The confirmation code is {{.Code}}. It expires in {{.ExpiresInMinutes}} minutes and can be tried {{.MaxAttempts}} times. Deleting cannot be undone. If this was not you, ignore this email and change your password.'
);
COMMIT;
PRAGMA foreign_keys = ON;
