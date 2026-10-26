CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(name) <= 255),
    description TEXT CHECK (length(description) <= 255),
    logo_url TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS org_members (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_one_owner
    ON org_members (tenant_id)
    WHERE role = 'OWNER';

CREATE INDEX IF NOT EXISTS idx_org_members_user_id
    ON org_members (user_id);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id
    ON org_members (tenant_id);

CREATE TABLE IF NOT EXISTS org_invitations (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    inviter_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role = 'ADMIN'),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invitations_pending
    ON org_invitations (tenant_id, lower(email))
    WHERE status = 'PENDING';