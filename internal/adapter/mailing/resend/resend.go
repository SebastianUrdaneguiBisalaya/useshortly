// Package resend implements mailing.Sender with the Resend API.
package resend

import (
	"context"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	resendlib "github.com/resend/resend-go/v4"
)

// Provider is the name stored in email_logs.email_provider.
const Provider = "RESEND"

type Sender struct {
	client *resendlib.Client
	from   string
}

// New returns a Sender that sends as from (e.g. "useshortly <no-reply@example.com>").
func New(apiKey, from string) *Sender {
	return &Sender{client: resendlib.NewClient(apiKey), from: from}
}

// Send posts the email to Resend. On success the receipt carries the id Resend assigns
// ({"id": "..."} in its 2xx answer). On failure the receipt still names the provider and
// the error holds Resend's message: for 4xx/5xx answers the SDK only keeps the "message"
// of the JSON body, and a 429 comes back as a *resendlib.RateLimitError with its limits.
func (s *Sender) Send(ctx context.Context, m mailing.Message) (mailing.Receipt, error) {
	receipt := mailing.Receipt{Provider: Provider}
	res, err := s.client.Emails.SendWithContext(ctx, &resendlib.SendEmailRequest{
		From:    s.from,
		To:      []string{m.To},
		Cc:      m.CC,
		Bcc:     m.BCC,
		Subject: m.Subject,
		Html:    m.HTML,
		Text:    m.Text,
	})
	if err != nil {
		return receipt, fmt.Errorf("resend: send: %w", err)
	}
	receipt.ProviderID = res.Id
	return receipt, nil
}
