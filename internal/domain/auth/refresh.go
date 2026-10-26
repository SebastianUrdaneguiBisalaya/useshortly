package auth

import (
	"context"
	"time"
)

// RefreshToken is a long-lived credential for one user in one tenant. Only the hash of
// the opaque token is stored.
type RefreshToken struct {
	ID        int64
	UserID    int64
	TenantID  int64
	TokenHash string
	ExpiresAt time.Time
	RevokedAt *time.Time
	CreatedAt time.Time
}

type RefreshTokenRepository interface {
	Create(ctx context.Context, t RefreshToken) (RefreshToken, error)
	// FindByHash returns ErrRefreshTokenNotFound.
	FindByHash(ctx context.Context, hash string) (RefreshToken, error)
	// Revoke returns ErrRefreshTokenNotFound.
	Revoke(ctx context.Context, id int64) error
	// RevokeForMember revokes every live token of the user in that tenant. It is a no-op
	// when there are none.
	RevokeForMember(ctx context.Context, userID, tenantID int64) error
}
