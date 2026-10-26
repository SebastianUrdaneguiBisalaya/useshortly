// Package resend implements mailing.Sender with the Resend API.
package resend

import (
	"context"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	resendlib "github.com/resend/resend-go/v4"
)

type Sender struct {
	client *resendlib.Client
	from   string
}

// New returns a Sender that sends as from (e.g. "useshortly <no-reply@example.com>").
func New(apiKey, from string) *Sender {
	return &Sender{client: resendlib.NewClient(apiKey), from: from}
}

func (s *Sender) Send(ctx context.Context, m mailing.Message) error {
	_, err := s.client.Emails.SendWithContext(ctx, &resendlib.SendEmailRequest{
		From:    s.from,
		To:      []string{m.To},
		Subject: m.Subject,
		Html:    m.HTML,
		Text:    m.Text,
	})
	if err != nil {
		return fmt.Errorf("resend: send: %w", err)
	}
	return nil
}
