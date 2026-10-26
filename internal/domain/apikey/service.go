package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	secretPrefix = "usl_"
	secretBytes  = 32
	visibleLen   = len(secretPrefix) + 8
	maxNameLen   = 100
)

type Service struct {
	repo Repository
	rand io.Reader
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, rand: rand.Reader, now: func() time.Time { return time.Now().UTC() }}
}

// Create returns the stored key and its secret. The secret is never stored and
// cannot be recovered later: show it to the user once.
func (s *Service) Create(ctx context.Context, tenantID, userID int64, name string, scope Scope, expiresAt *time.Time) (APIKey, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxNameLen {
		return APIKey{}, "", ErrInvalidName
	}
	if !scope.valid() {
		return APIKey{}, "", ErrInvalidScope
	}
	if expiresAt != nil && !expiresAt.After(s.now()) {
		return APIKey{}, "", ErrInvalidExpiry
	}
	if expiresAt != nil {
		u := expiresAt.UTC()
		expiresAt = &u
	}
	buf := make([]byte, secretBytes)
	if _, err := io.ReadFull(s.rand, buf); err != nil {
		return APIKey{}, "", err
	}
	secret := secretPrefix + base64.RawURLEncoding.EncodeToString(buf)
	k, err := s.repo.Create(ctx, APIKey{
		TenantID:  tenantID,
		CreatedBy: userID,
		Name:      name,
		Prefix:    secret[:visibleLen],
		KeyHash:   hashSecret(secret),
		Scope:     scope,
		ExpiresAt: expiresAt,
		CreatedAt: s.now(),
	})
	if err != nil {
		return APIKey{}, "", err
	}
	return k, secret, nil
}

func (s *Service) List(ctx context.Context, tenantID int64) ([]APIKey, error) {
	return s.repo.ListByTenant(ctx, tenantID)
}

func (s *Service) Delete(ctx context.Context, tenantID, id int64) error {
	return s.repo.Delete(ctx, tenantID, id)
}

// Authenticate resolves a secret to its key (and so to its tenant).
// Returns ErrNotFound for an unknown secret and ErrExpired for an expired key.
func (s *Service) Authenticate(ctx context.Context, secret string) (APIKey, error) {
	if !strings.HasPrefix(secret, secretPrefix) {
		return APIKey{}, ErrNotFound
	}
	k, err := s.repo.FindByHash(ctx, hashSecret(secret))
	if err != nil {
		return APIKey{}, err
	}
	now := s.now()
	if k.IsExpired(now) {
		return APIKey{}, ErrExpired
	}
	_ = s.repo.TouchLastUsed(ctx, k.ID, now) // best effort: usage stats must not fail auth
	return k, nil
}

// The secret has 256 bits of entropy, so a fast hash is enough (no salt or stretching needed).
func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
