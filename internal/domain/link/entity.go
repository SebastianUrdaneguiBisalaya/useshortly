package link

import "time"

// Link maps to the links table. TenantID is the organization that owns it.
type Link struct {
	ID        int64
	Code      string
	OriginURL string
	ExpiresAt *time.Time
	TenantID  int64
	CreatedBy int64
	UpdatedBy *int64
	CreatedAt time.Time
	UpdatedAt *time.Time
}

func (l Link) IsExpired(now time.Time) bool {
	return l.ExpiresAt != nil && now.UTC().After(*l.ExpiresAt)
}
