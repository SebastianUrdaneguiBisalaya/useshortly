-- Global templates (one per use case), editable with plain SQL. subject, body_html and
-- body_text are Go templates; {{.AppURL}} is always available, the rest depends on the code.
CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (code IN ('WELCOME', 'LOGIN', 'INVITATION')),
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT
);

INSERT OR IGNORE INTO email_templates (code, subject, body_html, body_text) VALUES
(
    'WELCOME',
    'Welcome to useshortly, {{.FirstName}}',
    '<p>Hi {{.FirstName}},</p><p>Your account is ready. Create your first organization to start shortening links.</p><p><a href="{{.AppURL}}">Open useshortly</a></p>',
    'Hi {{.FirstName}}, your account is ready. Create your first organization to start shortening links: {{.AppURL}}'
),
(
    'LOGIN',
    'New sign-in to useshortly',
    '<p>Hi {{.FirstName}},</p><p>We noticed a new sign-in to your account on {{.Time}}.</p><p>If this was not you, change your password right away.</p>',
    'Hi {{.FirstName}}, we noticed a new sign-in to your account on {{.Time}}. If this was not you, change your password right away.'
),
(
    'INVITATION',
    '{{.InviterName}} invited you to {{.OrganizationName}}',
    '<p>{{.InviterName}} invited you to join <strong>{{.OrganizationName}}</strong> on useshortly.</p><p><a href="{{.AppURL}}/invitations/{{.InvitationID}}">Accept the invitation</a></p><p>It expires on {{.ExpiresAt}}.</p>',
    '{{.InviterName}} invited you to join {{.OrganizationName}} on useshortly. Accept: {{.AppURL}}/invitations/{{.InvitationID}} (expires on {{.ExpiresAt}}).'
);
