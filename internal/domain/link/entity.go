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
	DomainID *int64
	// DomainHost is the host of that domain; the repository fills it on reads, it is ignored on Create.
	DomainHost string
	MaxClicks  *int64
	ClickCount int64
	// ChannelID is the campaign channel the link was shared in; nil is a link outside every campaign.
	ChannelID *int64
	// CampaignID is the campaign of that channel; the repository fills it on reads, it is ignored on Create.
	CampaignID *int64
	// PasswordHash is set for a password-protected link; it never leaves the server.
	PasswordHash string
	// QRStyle is how the link's QR code is drawn; the zero value is the default.
	QRStyle   QRStyle
	CreatedBy int64
	UpdatedBy *int64
	CreatedAt time.Time
	UpdatedAt *time.Time
}

// Protected reports whether visitors must unlock the link with a password.
func (l Link) Protected() bool { return l.PasswordHash != "" }

// IsExpired reports whether the link passed its expiration date or used all its clicks.
func (l Link) IsExpired(now time.Time) bool {
	byDate := l.ExpiresAt != nil && now.UTC().After(*l.ExpiresAt)
	byClicks := l.MaxClicks != nil && l.ClickCount >= *l.MaxClicks
	return byDate || byClicks
}
