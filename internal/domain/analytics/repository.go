package analytics

import "context"

type Repository interface {
	// Create stores the click and returns it with its ID set.
	Create(ctx context.Context, c Click) (Click, error)
}
