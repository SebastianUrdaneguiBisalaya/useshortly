package link

import "time"

type Link struct {
	ID        string
	Code      string
	OriginURL string
	CreatedAt time.Time
	UpdatedAt time.Time
	ExpiresAt *time.Time
}

func (l Link) IsExpired(now time.Time) bool {
	return l.ExpiresAt != nil && now.UTC().After(*l.ExpiresAt)
}
