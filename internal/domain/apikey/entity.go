package apikey

import "time"

// Scope is how much a key may do. Keys never get more than their scope, whoever created them.
type Scope string

const (
	ScopeRead  Scope = "read"  // safe, read-only requests
	ScopeWrite Scope = "write" // everything read can do, plus creating, changing and deleting
)

func (s Scope) valid() bool { return s == ScopeRead || s == ScopeWrite }

// Allows reports whether a key with scope s may do something that needs scope required.
func (s Scope) Allows(required Scope) bool {
	return s == ScopeWrite || (s == ScopeRead && required == ScopeRead)
}

// APIKey belongs to a tenant (organization) and is created by one of its users.
// Only the hash of the secret is stored; Prefix is the visible start of the secret.
type APIKey struct {
	ID         int64
	TenantID   int64
	CreatedBy  int64
	Name       string
	Prefix     string
	KeyHash    string
	Scope      Scope // fixed at creation
	LastUsedAt *time.Time
	ExpiresAt  *time.Time
	CreatedAt  time.Time
}

func (k APIKey) IsExpired(now time.Time) bool {
	return k.ExpiresAt != nil && now.UTC().After(*k.ExpiresAt)
}
