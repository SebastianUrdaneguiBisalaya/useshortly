package sqlite

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/campaign"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

func TestLinkRepositoryChannels(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	links := NewLinkRepository(db)
	campaigns := NewCampaignRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('other')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)

	a, _ := campaigns.Create(ctx, campaign.Campaign{TenantID: 1, Name: "A", CreatedAt: now})
	b, _ := campaigns.Create(ctx, campaign.Campaign{TenantID: 1, Name: "B", CreatedAt: now})
	insta, _ := campaigns.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Instagram", CreatedAt: now})
	mail, _ := campaigns.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Email", CreatedAt: now})
	other, _ := campaigns.CreateChannel(ctx, 1, campaign.Channel{CampaignID: b.ID, Name: "Instagram", CreatedAt: now})

	create := func(code string, channel *int64) link.Link {
		l, err := links.Create(ctx, link.Link{Code: code, OriginURL: "https://example.com/" + code, TenantID: 1, ChannelID: channel, CreatedBy: u.ID, CreatedAt: now})
		require.NoError(t, err)
		return l
	}

	l1 := create("link0001", &insta.ID)
	assert.Equal(t, &insta.ID, l1.ChannelID)
	require.NotNil(t, l1.CampaignID, "Create fills the campaign of the channel")
	assert.Equal(t, a.ID, *l1.CampaignID)
	create("link0002", &mail.ID)
	create("link0003", &other.ID)
	l4 := create("link0004", nil)
	assert.Nil(t, l4.ChannelID)
	assert.Nil(t, l4.CampaignID)

	got, err := links.FindByID(ctx, 1, l1.ID)
	require.NoError(t, err)
	assert.EqualValues(t, insta.ID, *got.ChannelID)
	assert.EqualValues(t, a.ID, *got.CampaignID)
	byCode, err := links.FindByCode(ctx, nil, "link0001")
	require.NoError(t, err)
	assert.EqualValues(t, a.ID, *byCode.CampaignID)
	got, err = links.FindByID(ctx, 1, l4.ID)
	require.NoError(t, err)
	assert.Nil(t, got.ChannelID)
	assert.Nil(t, got.CampaignID)

	codes := func(f link.ListFilter) ([]string, int) {
		list, total, err := links.ListByTenant(ctx, 1, f, page.Params{Limit: 10})
		require.NoError(t, err)
		var out []string
		for _, l := range list {
			out = append(out, l.Code)
		}
		return out, total
	}
	all, total := codes(link.ListFilter{})
	assert.Equal(t, 4, total)
	assert.Equal(t, []string{"link0004", "link0003", "link0002", "link0001"}, all)
	inA, total := codes(link.ListFilter{CampaignID: &a.ID})
	assert.Equal(t, 2, total)
	assert.Equal(t, []string{"link0002", "link0001"}, inA)
	inInsta, total := codes(link.ListFilter{ChannelID: &insta.ID})
	assert.Equal(t, 1, total)
	assert.Equal(t, []string{"link0001"}, inInsta)
	none, total := codes(link.ListFilter{CampaignID: &a.ID, ChannelID: &other.ID})
	assert.Zero(t, total)
	assert.Empty(t, none)
}

func TestLinkRepositorySetChannel(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	links := NewLinkRepository(db)
	campaigns := NewCampaignRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('other')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)
	a, _ := campaigns.Create(ctx, campaign.Campaign{TenantID: 1, Name: "A", CreatedAt: now})
	ch, _ := campaigns.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Instagram", CreatedAt: now})
	l, err := links.Create(ctx, link.Link{Code: "link0001", OriginURL: "https://example.com/a", TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)

	at := now.Add(time.Hour)
	require.NoError(t, links.SetChannel(ctx, 1, l.ID, &ch.ID, "https://example.com/a?utm_source=Instagram", u.ID, at))
	got, err := links.FindByID(ctx, 1, l.ID)
	require.NoError(t, err)
	assert.Equal(t, "https://example.com/a?utm_source=Instagram", got.OriginURL)
	assert.EqualValues(t, ch.ID, *got.ChannelID)
	assert.EqualValues(t, a.ID, *got.CampaignID)
	require.NotNil(t, got.UpdatedBy)
	assert.Equal(t, u.ID, *got.UpdatedBy)
	require.NotNil(t, got.UpdatedAt)
	assert.True(t, got.UpdatedAt.Equal(at))

	require.NoError(t, links.SetChannel(ctx, 1, l.ID, nil, "https://example.com/a", u.ID, at))
	got, err = links.FindByID(ctx, 1, l.ID)
	require.NoError(t, err)
	assert.Nil(t, got.ChannelID)
	assert.Nil(t, got.CampaignID)
	assert.Equal(t, "https://example.com/a", got.OriginURL)

	assert.ErrorIs(t, links.SetChannel(ctx, 2, l.ID, nil, "https://example.com/a", u.ID, at), link.ErrNotFound, "another tenant's link")
	assert.ErrorIs(t, links.SetChannel(ctx, 1, 999, nil, "https://example.com/a", u.ID, at), link.ErrNotFound)
}
