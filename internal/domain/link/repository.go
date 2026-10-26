package link

import "context"

type Repository interface {
	// Create stores the link and returns it with its ID set.
	// Returns ErrCodeTaken if the code already exists.
	Create(ctx context.Context, l Link) (Link, error)
	FindByCode(ctx context.Context, code string) (Link, error)
	// ConsumeClick counts one click atomically, so concurrent clicks never exceed max_clicks.
	// Returns ErrExpired if the link already used all its clicks.
	ConsumeClick(ctx context.Context, code string) error
}
