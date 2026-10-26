package mailing

import "time"

// Template codes. Plain string constants so consumers can declare their own
// Mailer interface without importing this package's types.
const (
	TemplateWelcome       = "WELCOME"
	TemplateLogin         = "LOGIN"
	TemplateInvitation    = "INVITATION"
	TemplatePasswordReset = "PASSWORD_RESET"
	TemplateVerifyEmail   = "VERIFY_EMAIL"
)

// Template is a row of email_templates. Subject, BodyHTML and BodyText are Go templates.
type Template struct {
	ID        int64
	Code      string
	Subject   string
	BodyHTML  string
	BodyText  string
	CreatedAt time.Time
	UpdatedAt *time.Time
}

// Message is a rendered email ready to be sent.
type Message struct {
	To      string
	Subject string
	HTML    string
	Text    string
}
