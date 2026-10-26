package apikey

import (
	"context"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type Repository interface {
	Create(ctx context.Context, k APIKey) (APIKey, error)
	ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]APIKey, int, error)
	// Delete returns ErrNotFound if the key does not exist in that tenant.
	Delete(ctx context.Context, tenantID, id int64) error
	// FindByHash returns ErrNotFound if no key has that hash.
	FindByHash(ctx context.Context, hash string) (APIKey, error)
	TouchLastUsed(ctx context.Context, id int64, at time.Time) error
}
