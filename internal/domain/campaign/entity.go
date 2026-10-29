// Package campaign groups an organization's links by marketing initiative and splits each campaign
// into channels, the places its links are shared (Instagram, email...).
package campaign

import "time"

// Campaign maps to the campaigns table. TenantID is the organization that owns it.
type Campaign struct {
	ID          int64
	TenantID    int64
	Name        string
	Description string
	// ChannelCount and LinkCount are filled by the repository on reads and ignored on writes.
	ChannelCount int64
	LinkCount    int64
	CreatedBy    int64 // 0 once the user who created it was deleted
	CreatedAt    time.Time
	UpdatedAt    *time.Time
}

// Channel is one place a campaign is shared. Its name becomes the utm_source of the campaign's
// links in it, so the same destination gets separate analytics per channel.
type Channel struct {
	ID         int64
	CampaignID int64
	Name       string
	// CampaignName is filled by the repository on reads and ignored on writes.
	CampaignName string
	CreatedAt    time.Time
}

// ExportRow is one link of a campaign with the clicks it got, for the export.
type ExportRow struct {
	LinkID int64
	Code   string
	// DomainHost is the custom domain the link is served from; empty is the default host.
	DomainHost string
	OriginURL  string
	Channel    string
	Clicks     int64
	CreatedAt  time.Time
}
