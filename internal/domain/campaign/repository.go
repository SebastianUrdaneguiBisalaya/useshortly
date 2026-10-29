package campaign

import (
	"context"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type Repository interface {
	// Create stores the campaign and returns it with its ID set.
	// Returns ErrNameTaken if the tenant already has a campaign with that name.
	Create(ctx context.Context, c Campaign) (Campaign, error)
	// FindByID returns the tenant's campaign, or ErrNotFound if it does not exist or is another tenant's.
	FindByID(ctx context.Context, tenantID, id int64) (Campaign, error)
	// ListByTenant returns one page of the tenant's campaigns, newest first, and how many it has in total.
	ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]Campaign, int, error)
	// Update replaces the name and description of the tenant's campaign.
	// Returns ErrNotFound for an unknown campaign and ErrNameTaken for a name already in use.
	Update(ctx context.Context, tenantID, id int64, name, description string, at time.Time) (Campaign, error)
	// Delete removes the tenant's campaign and its channels; its links stay, outside every campaign.
	// Returns ErrNotFound if it does not exist or belongs to another tenant.
	Delete(ctx context.Context, tenantID, id int64) error

	// CreateChannel stores a channel in the tenant's campaign and returns it with its ID set.
	// Returns ErrNotFound if the tenant has no such campaign and ErrChannelNameTaken for a name
	// already used in it.
	CreateChannel(ctx context.Context, tenantID int64, ch Channel) (Channel, error)
	// FindChannel returns the tenant's channel, or ErrChannelNotFound if it does not exist or is another tenant's.
	FindChannel(ctx context.Context, tenantID, id int64) (Channel, error)
	// ListChannels returns one page of the campaign's channels, oldest first, and how many it has in
	// total. Returns ErrNotFound if the tenant has no such campaign.
	ListChannels(ctx context.Context, tenantID, campaignID int64, p page.Params) ([]Channel, int, error)
	// DeleteChannel removes the channel of the tenant's campaign; its links stay, outside every campaign.
	// Returns ErrChannelNotFound if it does not exist in that campaign.
	DeleteChannel(ctx context.Context, tenantID, campaignID, id int64) error

	// Export lists every link of the tenant's campaign with the clicks it got with from <= at < to
	// (a zero time leaves that side open). Returns ErrNotFound if the tenant has no such campaign.
	Export(ctx context.Context, tenantID, campaignID int64, from, to time.Time) ([]ExportRow, error)
}
