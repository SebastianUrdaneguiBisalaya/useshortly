package link

import "context"

type Repository interface {
	// Create stores the link and returns it with its ID set.
	// Returns ErrCodeTaken if the code already exists.
	Create(ctx context.Context, l Link) (Link, error)
	FindByCode(ctx context.Context, code string) (Link, error)
}
