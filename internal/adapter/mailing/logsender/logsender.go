// Package logsender implements mailing.Sender by logging the email instead of sending it.
// It is the development fallback when no email provider is configured: it lets you read
// the one-time codes in the server log.
package logsender

import (
	"context"
	"log/slog"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

// Provider is the name stored in email_logs.email_provider.
const Provider = "LOG"

type Sender struct{}

func New() Sender { return Sender{} }

func (Sender) Send(_ context.Context, m mailing.Message) (mailing.Receipt, error) {
	slog.Info("email not sent (no provider configured)",
		"to", m.To, "cc", m.CC, "bcc", m.BCC, "subject", m.Subject, "text", m.Text)
	return mailing.Receipt{Provider: Provider}, nil
}
