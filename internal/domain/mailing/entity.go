package mailing

import "time"

// Template codes. Plain string constants so consumers can name a template without
// depending on this package's types.
const (
	TemplateWelcome         = "WELCOME"
	TemplateLogin           = "LOGIN"
	TemplateInvitation      = "INVITATION"
	TemplatePasswordReset   = "PASSWORD_RESET"
	TemplateVerifyEmail     = "VERIFY_EMAIL"
	TemplateAccountDeletion = "ACCOUNT_DELETION"
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

// Request asks for a template to be rendered with Data and sent to To, optionally with
// copies (CC) and blind copies (BCC).
type Request struct {
	Code string
	To   string
	CC   []string
	BCC  []string
	Data map[string]string
}

// Message is a rendered email ready to be sent.
type Message struct {
	To      string
	CC      []string
	BCC     []string
	Subject string
	HTML    string
	Text    string
}

// Receipt is what a provider answers: its name and, when it accepted the email, the unique
// id it assigned to it. A Sender returns the Provider even when the send failed.
type Receipt struct {
	Provider   string
	ProviderID string
}

type LogStatus string

const (
	LogSent   LogStatus = "SENT"
	LogFailed LogStatus = "FAILED"
)

// EmailLog is the record of one delivery attempt, kept for both outcomes.
type EmailLog struct {
	ID         int64
	TemplateID int64
	To         string
	CC         []string
	BCC        []string
	Status     LogStatus
	Provider   string
	ProviderID string         // set when SENT
	Error      *ProviderError // set when FAILED
	CreatedAt  time.Time
}
