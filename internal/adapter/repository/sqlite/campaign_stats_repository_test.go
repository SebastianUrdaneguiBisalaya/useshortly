package sqlite

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/campaign"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
)

func TestClickRepositoryCampaignStats(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	links := NewLinkRepository(db)
	campaigns := NewCampaignRepository(db)
	clicks := NewClickRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('other')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)

	a, _ := campaigns.Create(ctx, campaign.Campaign{TenantID: 1, Name: "A", CreatedAt: now})
	b, _ := campaigns.Create(ctx, campaign.Campaign{TenantID: 1, Name: "B", CreatedAt: now})
	insta, _ := campaigns.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Instagram", CreatedAt: now})
	mail, _ := campaigns.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Email", CreatedAt: now})
	_, _ = campaigns.CreateChannel(ctx, 1, campaign.Channel{CampaignID: a.ID, Name: "Quiet", CreatedAt: now})
	bch, _ := campaigns.CreateChannel(ctx, 1, campaign.Channel{CampaignID: b.ID, Name: "Instagram", CreatedAt: now})

	newLink := func(code string, channel *int64) int64 {
		l, err := links.Create(ctx, link.Link{Code: code, OriginURL: "https://example.com/" + code, TenantID: 1, ChannelID: channel, CreatedBy: u.ID, CreatedAt: now})
		require.NoError(t, err)
		return l.ID
	}
	l1, l2, l3, loose := newLink("link0001", &insta.ID), newLink("link0002", &insta.ID), newLink("link0003", &mail.ID), newLink("link0004", &bch.ID)
	outside := newLink("link0005", nil)

	day := func(d int) time.Time { return time.Date(2026, 1, d, 10, 0, 0, 0, time.UTC) }
	click := func(link int64, at time.Time, country, device, referrer string) {
		_, err := clicks.Create(ctx, analytics.Click{LinkID: link, At: at, Country: country, Device: device, Referrer: referrer})
		require.NoError(t, err)
	}
	click(l1, day(1), "PE", "mobile", "https://t.co")
	click(l1, day(2), "PE", "desktop", "")
	click(l2, day(2), "US", "mobile", "https://t.co")
	click(l3, day(2), "US", "mobile", "")
	click(l3, day(10), "PE", "mobile", "")     // outside the window below
	click(loose, day(2), "PE", "mobile", "")   // another campaign's
	click(outside, day(2), "PE", "mobile", "") // no campaign

	from, to := day(1).Truncate(24*time.Hour), day(4).Truncate(24*time.Hour)
	st, channels, err := clicks.CampaignStats(ctx, 1, a.ID, from, to, time.UTC, analytics.Filter{})
	require.NoError(t, err)
	assert.EqualValues(t, 4, st.Total, "only the campaign's clicks inside the window")
	assert.Equal(t, []analytics.DayCount{{Date: "2026-01-01", Clicks: 1}, {Date: "2026-01-02", Clicks: 3}}, st.Daily)
	assert.EqualValues(t, 4, st.ByHour[10])
	assert.Equal(t, []analytics.Count{{Name: "PE", Clicks: 2}, {Name: "US", Clicks: 2}}, st.Countries)
	assert.Equal(t, []analytics.Count{{Name: "mobile", Clicks: 3}, {Name: "desktop", Clicks: 1}}, st.Devices)
	assert.Equal(t, []analytics.ChannelCount{
		{ID: insta.ID, Name: "Instagram", Clicks: 3},
		{ID: mail.ID, Name: "Email", Clicks: 1},
		{ID: channels[2].ID, Name: "Quiet", Clicks: 0},
	}, channels, "every channel is listed, the quiet one with zero")

	mobile := "mobile"
	st, channels, err = clicks.CampaignStats(ctx, 1, a.ID, from, to, time.UTC, analytics.Filter{Device: &mobile})
	require.NoError(t, err)
	assert.EqualValues(t, 3, st.Total)
	assert.EqualValues(t, 2, channels[0].Clicks, "the filter also narrows the channel counts")
	assert.EqualValues(t, 1, channels[1].Clicks)

	total, err := clicks.CampaignTotal(ctx, 1, a.ID, from, to, analytics.Filter{})
	require.NoError(t, err)
	assert.EqualValues(t, 4, total)
	total, err = clicks.CampaignTotal(ctx, 1, b.ID, from, to, analytics.Filter{})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)

	_, _, err = clicks.CampaignStats(ctx, 2, a.ID, from, to, time.UTC, analytics.Filter{})
	assert.ErrorIs(t, err, analytics.ErrCampaignNotFound, "another tenant's campaign looks unknown")
	_, err = clicks.CampaignTotal(ctx, 2, a.ID, from, to, analytics.Filter{})
	assert.ErrorIs(t, err, analytics.ErrCampaignNotFound)
}
