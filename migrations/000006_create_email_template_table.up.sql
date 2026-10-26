-- Global templates (one per use case), editable with plain SQL. subject, body_html and
-- body_text are Go templates; {{.AppURL}} is always available, the rest depends on the code.
CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (code IN ('WELCOME', 'LOGIN', 'INVITATION', 'PASSWORD_RESET', 'VERIFY_EMAIL')),
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
),
(
    'PASSWORD_RESET',
    'Your useshortly password reset code',
    '<p>Hi {{.FirstName}},</p><p>Your password reset code is:</p><p style="font-size:24px;letter-spacing:4px"><strong>{{.Code}}</strong></p><p>It expires in {{.ExpiresInMinutes}} minutes and can be tried {{.MaxAttempts}} times. If you did not ask for it, ignore this email.</p>',
    'Hi {{.FirstName}}, your password reset code is {{.Code}}. It expires in {{.ExpiresInMinutes}} minutes and can be tried {{.MaxAttempts}} times. If you did not ask for it, ignore this email.'
),
(
    'VERIFY_EMAIL',
    'Confirm your email for useshortly',
    '<p>Hi {{.FirstName}},</p><p>Someone used this address to create a useshortly account. Your confirmation code is:</p><p style="font-size:24px;letter-spacing:4px"><strong>{{.Code}}</strong></p><p>It expires in {{.ExpiresInMinutes}} minutes and can be tried {{.MaxAttempts}} times. If this was not you, ignore this email and no account will be created.</p>',
    'Hi {{.FirstName}}, someone used this address to create a useshortly account. Your confirmation code is {{.Code}}. It expires in {{.ExpiresInMinutes}} minutes and can be tried {{.MaxAttempts}} times. If this was not you, ignore this email and no account will be created.'
);

-- One row per delivery attempt, success or failure. Recipients are plain emails (not user
-- ids): invitation and signup emails go to people who are not users yet, and logs must
-- outlive users and templates. cc and bcc are JSON arrays of emails.
CREATE TABLE IF NOT EXISTS email_logs (
    id INTEGER PRIMARY KEY,
    template_id INTEGER NOT NULL,
    to_email TEXT NOT NULL,
    cc TEXT,
    bcc TEXT,
    status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED')),
    email_provider TEXT NOT NULL,
    email_provider_id TEXT, -- the unique id the provider returns when it accepts the email
    error_metadata TEXT,    -- when it does not: JSON {"type", "code", "message"}
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (template_id) REFERENCES email_templates(id)
);

CREATE INDEX IF NOT EXISTS idx_email_logs_template_created
    ON email_logs (template_id, created_at);

CREATE INDEX IF NOT EXISTS idx_email_logs_to_email
    ON email_logs (to_email);