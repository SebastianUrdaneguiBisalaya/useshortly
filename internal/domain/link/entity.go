package link

import "time"

// Link maps to the links table. TenantID is the organization that owns it.
type Link struct {
	ID        int64
	Code      string
	OriginURL string
	ExpiresAt *time.Time
	TenantID  int64
	// DomainID is the custom domain the link is served from; nil is the default host.
	DomainID   *int64
	MaxClicks  *int64
	ClickCount int64
	// PasswordHash is set for a password-protected link; it never leaves the server.
	PasswordHash string
	CreatedBy    int64
	UpdatedBy    *int64
	CreatedAt    time.Time
	UpdatedAt    *time.Time
}

// Protected reports whether visitors must unlock the link with a password.
func (l Link) Protected() bool { return l.PasswordHash != "" }

// IsExpired reports whether the link passed its expiration date or used all its clicks.
func (l Link) IsExpired(now time.Time) bool {
	byDate := l.ExpiresAt != nil && now.UTC().After(*l.ExpiresAt)
	byClicks := l.MaxClicks != nil && l.ClickCount >= *l.MaxClicks
	return byDate || byClicks
}
