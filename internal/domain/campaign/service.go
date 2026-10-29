package campaign

import (
	"context"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

const (
	maxNameLen        = 100
	maxDescriptionLen = 500
	maxChannelNameLen = 50
	// MaxChannels is how many channels one campaign can have.
	MaxChannels = 100
)

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// CreateInput is what a caller sets when creating a campaign; Description is optional.
type CreateInput struct {
	TenantID    int64
	UserID      int64
	Name        string
	Description string
}

// Create makes a campaign of the tenant.
func (s *Service) Create(ctx context.Context, in CreateInput) (Campaign, error) {
	name, err := cleanName(in.Name, maxNameLen, ErrInvalidName)
	if err != nil {
		return Campaign{}, err
	}
	description, err := cleanDescription(in.Description)
	if err != nil {
		return Campaign{}, err
	}
	return s.repo.Create(ctx, Campaign{
		TenantID: in.TenantID, Name: name, Description: description, CreatedBy: in.UserID, CreatedAt: s.now(),
	})
}

// UpdateInput changes a campaign; a nil field is left as it is. Links already in the campaign keep
// the utm_campaign they were given, so a new name only reaches the links added afterwards.
type UpdateInput struct {
	TenantID    int64
	ID          int64
	Name        *string
	Description *string
}

// Update changes the name and/or the description of a campaign of the tenant.
func (s *Service) Update(ctx context.Context, in UpdateInput) (Campaign, error) {
	c, err := s.repo.FindByID(ctx, in.TenantID, in.ID)
	if err != nil {
		return Campaign{}, err
	}
	name, description := c.Name, c.Description
	if in.Name != nil {
		if name, err = cleanName(*in.Name, maxNameLen, ErrInvalidName); err != nil {
			return Campaign{}, err
		}
	}
	if in.Description != nil {
		if description, err = cleanDescription(*in.Description); err != nil {
			return Campaign{}, err
		}
	}
	return s.repo.Update(ctx, in.TenantID, in.ID, name, description, s.now())
}

// Get returns one campaign of the tenant; a campaign of another tenant is ErrNotFound.
func (s *Service) Get(ctx context.Context, tenantID, id int64) (Campaign, error) {
	return s.repo.FindByID(ctx, tenantID, id)
}

// List returns one page of the tenant's campaigns, newest first, and how many it has in total.
func (s *Service) List(ctx context.Context, tenantID int64, p page.Params) ([]Campaign, int, error) {
	return s.repo.ListByTenant(ctx, tenantID, p.Normalize())
}

// Delete removes a campaign of the tenant with its channels. Its links stay and keep the UTM
// parameters they already carry.
func (s *Service) Delete(ctx context.Context, tenantID, id int64) error {
	return s.repo.Delete(ctx, tenantID, id)
}

// AddChannel creates a channel in a campaign of the tenant, up to MaxChannels per campaign.
func (s *Service) AddChannel(ctx context.Context, tenantID, campaignID int64, name string) (Channel, error) {
	name, err := cleanName(name, maxChannelNameLen, ErrInvalidChannelName)
	if err != nil {
		return Channel{}, err
	}
	_, total, err := s.repo.ListChannels(ctx, tenantID, campaignID, page.Params{Limit: 1})
	if err != nil {
		return Channel{}, err
	}
	if total >= MaxChannels {
		return Channel{}, ErrTooManyChannels
	}
	return s.repo.CreateChannel(ctx, tenantID, Channel{CampaignID: campaignID, Name: name, CreatedAt: s.now()})
}

// Channels returns one page of the channels of a campaign of the tenant, oldest first.
func (s *Service) Channels(ctx context.Context, tenantID, campaignID int64, p page.Params) ([]Channel, int, error) {
	return s.repo.ListChannels(ctx, tenantID, campaignID, p.Normalize())
}

// DeleteChannel removes a channel of a campaign of the tenant. Its links stay and keep the UTM
// parameters they already carry.
func (s *Service) DeleteChannel(ctx context.Context, tenantID, campaignID, channelID int64) error {
	return s.repo.DeleteChannel(ctx, tenantID, campaignID, channelID)
}

// Resolve names the campaign and the channel a link shared in channelID is tagged with, for the
// utm_campaign and utm_source parameters. A channel of another tenant is ErrChannelNotFound.
func (s *Service) Resolve(ctx context.Context, tenantID, channelID int64) (campaignName, channelName string, err error) {
	ch, err := s.repo.FindChannel(ctx, tenantID, channelID)
	if err != nil {
		return "", "", err
	}
	return ch.CampaignName, ch.Name, nil
}

// Export lists the links of a campaign of the tenant with the clicks they got between the days
// from and to, both included (UTC). A zero day leaves that side open, so with neither it counts
// every click.
func (s *Service) Export(ctx context.Context, tenantID, campaignID int64, from, to time.Time) ([]ExportRow, error) {
	if !from.IsZero() {
		from = day(from)
	}
	if !to.IsZero() {
		to = day(to).AddDate(0, 0, 1) // the repository takes a half-open range
	}
	if !from.IsZero() && !to.IsZero() && !from.Before(to) {
		return nil, ErrInvalidRange
	}
	rows, err := s.repo.Export(ctx, tenantID, campaignID, from, to)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []ExportRow{}
	}
	return rows, nil
}

func day(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// cleanName trims a name and checks it is 1..max characters without control characters.
func cleanName(name string, max int, invalid error) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > max || hasControl(name) {
		return "", invalid
	}
	return name, nil
}

// cleanDescription trims a description; empty is fine. Line breaks are allowed.
func cleanDescription(description string) (string, error) {
	description = strings.TrimSpace(description)
	if utf8.RuneCountInString(description) > maxDescriptionLen || strings.ContainsFunc(description, func(r rune) bool {
		return unicode.IsControl(r) && r != '\n' && r != '\t'
	}) {
		return "", ErrInvalidDescription
	}
	return description, nil
}

func hasControl(s string) bool { return strings.ContainsFunc(s, unicode.IsControl) }
