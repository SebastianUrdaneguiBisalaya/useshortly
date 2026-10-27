package domain

import (
	"context"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type Repository interface {
	// Create stores the domain and returns it with its ID set.
	// Returns ErrHostTaken if the host is already registered, by any tenant.
	Create(ctx context.Context, d Domain) (Domain, error)
	// FindByID returns the tenant's domain, or ErrNotFound if it does not exist or is another tenant's.
	FindByID(ctx context.Context, tenantID, id int64) (Domain, error)
	// FindByHost returns ErrNotFound if no tenant registered that host.
	FindByHost(ctx context.Context, host string) (Domain, error)
	ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]Domain, int, error)
	// MarkVerified sets VerifiedAt. Returns ErrNotFound if the tenant has no such domain.
	MarkVerified(ctx context.Context, tenantID, id int64, at time.Time) error
	// Delete removes the tenant's domain. Returns ErrNotFound if it does not exist or is another tenant's.
	Delete(ctx context.Context, tenantID, id int64) error
}
