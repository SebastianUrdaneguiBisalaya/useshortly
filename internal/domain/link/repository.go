package link

import (
	"context"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type Repository interface {
	// Create stores the link and returns it with its ID set.
	// Returns ErrCodeTaken if the code already exists.
	Create(ctx context.Context, l Link) (Link, error)
	// FindByCode looks the code up in one domain: nil is the instance's default host.
	FindByCode(ctx context.Context, domainID *int64, code string) (Link, error)
	// FindByID returns the tenant's link, or ErrNotFound if it does not exist or is another tenant's.
	FindByID(ctx context.Context, tenantID, id int64) (Link, error)
	// ListByTenant returns one page of the tenant's links, newest first, and how many it has in total.
	ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]Link, int, error)
	// Delete removes the tenant's link. Returns ErrNotFound if it does not exist or belongs to another tenant.
	Delete(ctx context.Context, tenantID, id int64) error
	// ConsumeClick counts one click atomically, so concurrent clicks never exceed max_clicks.
	// Returns ErrExpired if the link already used all its clicks.
	ConsumeClick(ctx context.Context, id int64) error
}
