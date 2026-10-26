package mailing

import "context"

// Sender delivers a rendered message through a provider (Resend, SMTP...).
type Sender interface {
	Send(ctx context.Context, m Message) error
}

type TemplateRepository interface {
	// FindByCode returns ErrTemplateNotFound.
	FindByCode(ctx context.Context, code string) (Template, error)
}
