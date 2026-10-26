package apikey

import "time"

// APIKey belongs to a tenant (organization) and is created by one of its users.
// Only the hash of the secret is stored; Prefix is the visible start of the secret.
type APIKey struct {
	ID         int64
	TenantID   int64
	CreatedBy  int64
	Name       string
	Prefix     string
	KeyHash    string
	LastUsedAt *time.Time
	ExpiresAt  *time.Time
	CreatedAt  time.Time
}

func (k APIKey) IsExpired(now time.Time) bool {
	return k.ExpiresAt != nil && now.UTC().After(*k.ExpiresAt)
}
