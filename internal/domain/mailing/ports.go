package mailing

import "context"

// Sender delivers a rendered message through a provider (Resend, SMTP...). It returns the
// provider's Receipt: on success the id of the accepted email, on failure at least the
// provider name together with the error.
type Sender interface {
	Send(ctx context.Context, m Message) (Receipt, error)
}

type TemplateRepository interface {
	// FindByCode returns ErrTemplateNotFound.
	FindByCode(ctx context.Context, code string) (Template, error)
}

type LogRepository interface {
	Create(ctx context.Context, l EmailLog) error
}
