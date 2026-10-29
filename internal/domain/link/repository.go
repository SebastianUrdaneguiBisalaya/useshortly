package link

import (
	"context"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type Repository interface {
	// Create stores the link and returns it with its ID set.
	// Returns ErrCodeTaken if the code already exists.
	Create(ctx context.Context, l Link) (Link, error)
	// FindByCode looks the code up in one domain: nil is the instance's default host.
	FindByCode(ctx context.Context, domainID *int64, code string) (Link, error)
	// FindByID returns the tenant's link, or ErrNotFound if it does not exist or is another tenant's.
	FindByID(ctx context.Context, tenantID, id int64) (Link, error)
	// ListByTenant returns one page of the tenant's links that pass the filter, newest first, and how
	// many pass it in total.
	ListByTenant(ctx context.Context, tenantID int64, f ListFilter, p page.Params) ([]Link, int, error)
	// Delete removes the tenant's link. Returns ErrNotFound if it does not exist or belongs to another tenant.
	Delete(ctx context.Context, tenantID, id int64) error
	// SetQRStyle stores the style of the tenant's link; a zero style clears it. Returns ErrNotFound if
	// the link does not exist or is another tenant's.
	SetQRStyle(ctx context.Context, tenantID, id int64, style QRStyle) error
	// SetChannel puts the tenant's link in a channel (nil takes it out of its campaign) and stores
	// the destination that goes with it. Returns ErrNotFound if the link does not exist or is
	// another tenant's.
	SetChannel(ctx context.Context, tenantID, id int64, channelID *int64, originURL string, updatedBy int64, at time.Time) error
	// ConsumeClick counts one click atomically, so concurrent clicks never exceed max_clicks.
	// Returns ErrExpired if the link already used all its clicks.
	ConsumeClick(ctx context.Context, id int64) error
}

// ListFilter narrows a list of links; a nil field does not filter.
type ListFilter struct {
	// CampaignID keeps the links in any channel of the campaign.
	CampaignID *int64
	// ChannelID keeps the links in the channel.
	ChannelID *int64
}
