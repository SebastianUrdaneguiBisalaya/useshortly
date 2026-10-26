package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

const (
	refreshPrefix      = "rft_"
	refreshSecretBytes = 32
)

// RefreshToken is a long-lived credential. Only the hash of the opaque secret is stored.
// TenantID is zero for the tokens login issues (they belong to the user, not to one
// organization: access to an organization is checked on every request).
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
	// Revoke marks the token revoked at the given instant and reports whether this call did
	// it: false means it was already revoked. Returns ErrRefreshTokenNotFound.
	Revoke(ctx context.Context, id int64, at time.Time) (bool, error)
	// RevokeForMember revokes every live token the user holds for that tenant.
	RevokeForMember(ctx context.Context, userID, tenantID int64, at time.Time) error
	// RevokeForUser revokes every live token of the user, in all tenants.
	RevokeForUser(ctx context.Context, userID int64, at time.Time) error
}

// RefreshGrant is a freshly issued refresh token: the secret is shown once.
type RefreshGrant struct {
	Token     string
	ExpiresAt time.Time
}

type RefreshService struct {
	repo RefreshTokenRepository
	ttl  time.Duration
	rand io.Reader
	now  func() time.Time
}

func NewRefreshService(repo RefreshTokenRepository, ttl time.Duration) *RefreshService {
	return &RefreshService{repo: repo, ttl: ttl, rand: rand.Reader, now: func() time.Time { return time.Now().UTC() }}
}

// Issue creates a refresh token for the user.
func (s *RefreshService) Issue(ctx context.Context, userID int64) (RefreshGrant, error) {
	return s.issue(ctx, userID, 0)
}

func (s *RefreshService) issue(ctx context.Context, userID, tenantID int64) (RefreshGrant, error) {
	buf := make([]byte, refreshSecretBytes)
	if _, err := io.ReadFull(s.rand, buf); err != nil {
		return RefreshGrant{}, fmt.Errorf("auth: refresh token: %w", err)
	}
	secret := refreshPrefix + base64.RawURLEncoding.EncodeToString(buf)
	now := s.now()
	expires := now.Add(s.ttl)
	_, err := s.repo.Create(ctx, RefreshToken{
		UserID: userID, TenantID: tenantID, TokenHash: hashRefresh(secret), ExpiresAt: expires, CreatedAt: now,
	})
	if err != nil {
		return RefreshGrant{}, err
	}
	return RefreshGrant{Token: secret, ExpiresAt: expires}, nil
}

// Rotate exchanges a refresh token for a new one (each token works once) and returns the
// user it belongs to. Unknown, expired and revoked tokens are all ErrInvalidCredentials.
// Presenting a token that was already used means it leaked, so every session of that user
// is revoked.
func (s *RefreshService) Rotate(ctx context.Context, secret string) (int64, RefreshGrant, error) {
	if !strings.HasPrefix(secret, refreshPrefix) {
		return 0, RefreshGrant{}, ErrInvalidCredentials
	}
	t, err := s.repo.FindByHash(ctx, hashRefresh(secret))
	if errors.Is(err, ErrRefreshTokenNotFound) {
		return 0, RefreshGrant{}, ErrInvalidCredentials
	}
	if err != nil {
		return 0, RefreshGrant{}, err
	}
	now := s.now()
	if t.RevokedAt != nil {
		return 0, RefreshGrant{}, s.reuse(ctx, t.UserID, now)
	}
	if now.After(t.ExpiresAt) {
		return 0, RefreshGrant{}, ErrInvalidCredentials
	}
	won, err := s.repo.Revoke(ctx, t.ID, now)
	if err != nil {
		return 0, RefreshGrant{}, err
	}
	if !won { // a concurrent request used it first
		return 0, RefreshGrant{}, s.reuse(ctx, t.UserID, now)
	}
	grant, err := s.issue(ctx, t.UserID, t.TenantID)
	if err != nil {
		return 0, RefreshGrant{}, err
	}
	return t.UserID, grant, nil
}

func (s *RefreshService) reuse(ctx context.Context, userID int64, now time.Time) error {
	if err := s.repo.RevokeForUser(ctx, userID, now); err != nil {
		return err
	}
	return ErrInvalidCredentials
}

// Revoke ends the session of one refresh token (logout). Unknown tokens are not an error,
// so the call cannot be used to probe which tokens exist.
func (s *RefreshService) Revoke(ctx context.Context, secret string) error {
	t, err := s.repo.FindByHash(ctx, hashRefresh(secret))
	if errors.Is(err, ErrRefreshTokenNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = s.repo.Revoke(ctx, t.ID, s.now())
	return err
}

// RevokeForMember and RevokeForUser let the services that own memberships and passwords
// end sessions without knowing about clocks or hashes.
func (s *RefreshService) RevokeForMember(ctx context.Context, userID, tenantID int64) error {
	return s.repo.RevokeForMember(ctx, userID, tenantID, s.now())
}

func (s *RefreshService) RevokeForUser(ctx context.Context, userID int64) error {
	return s.repo.RevokeForUser(ctx, userID, s.now())
}

func hashRefresh(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
