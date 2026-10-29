package analytics

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeCampaignRepo struct {
	got struct {
		tenant, campaign int64
		from, to         time.Time
		filter           Filter
		loc              *time.Location
	}
	stats        Stats
	channels     []ChannelCount
	previous     int64
	previousFrom time.Time
	previousTo   time.Time
	err          error
}

func (f *fakeCampaignRepo) CampaignStats(_ context.Context, tenantID, campaignID int64, from, to time.Time, loc *time.Location, flt Filter) (Stats, []ChannelCount, error) {
	f.got.tenant, f.got.campaign, f.got.from, f.got.to, f.got.loc, f.got.filter = tenantID, campaignID, from, to, loc, flt
	return f.stats, f.channels, f.err
}

func (f *fakeCampaignRepo) CampaignTotal(_ context.Context, _, _ int64, from, to time.Time, _ Filter) (int64, error) {
	f.previousFrom, f.previousTo = from, to
	return f.previous, f.err
}

func newCampaignStatsService(repo CampaignStatsRepository) *Service {
	return newStatsService(&fakeStatsRepo{}).WithCampaigns(repo)
}

func TestCampaignStatsCoversTheWindowAndComparesWithTheLast(t *testing.T) {
	repo := &fakeCampaignRepo{
		stats:    Stats{Total: 5, Daily: []DayCount{{Date: "2026-03-02", Clicks: 5}}, Countries: []Count{{Name: "", Clicks: 5}}},
		channels: []ChannelCount{{ID: 1, Name: "Instagram", Clicks: 5}, {ID: 2, Name: "Email"}},
		previous: 3,
	}
	st, err := newCampaignStatsService(repo).CampaignStats(context.Background(), CampaignQuery{
		TenantID: 4, CampaignID: 9, From: date("2026-03-01"), To: date("2026-03-03"), Device: "Mobile",
	})
	require.NoError(t, err)

	assert.EqualValues(t, 4, repo.got.tenant)
	assert.EqualValues(t, 9, repo.got.campaign)
	assert.Equal(t, date("2026-03-01"), repo.got.from)
	assert.Equal(t, date("2026-03-04"), repo.got.to, "the last day is included")
	require.NotNil(t, repo.got.filter.Device)
	assert.Equal(t, "mobile", *repo.got.filter.Device)
	assert.Equal(t, date("2026-02-26"), repo.previousFrom, "the previous window is as long as this one")
	assert.Equal(t, date("2026-03-01"), repo.previousTo)

	assert.EqualValues(t, 9, st.CampaignID)
	assert.EqualValues(t, 5, st.Total)
	assert.EqualValues(t, 3, st.PreviousTotal)
	assert.Equal(t, "2026-03-01", st.From)
	assert.Equal(t, "2026-03-03", st.To)
	assert.Equal(t, []DayCount{{"2026-03-01", 0}, {"2026-03-02", 5}, {"2026-03-03", 0}}, st.Daily)
	assert.Len(t, st.ByHour, 24)
	assert.Len(t, st.ByWeekday, 7)
	assert.Equal(t, "unknown", st.Countries[0].Name)
	assert.Equal(t, repo.channels, st.Channels)
}

func TestCampaignStatsListsAreNeverNil(t *testing.T) {
	st, err := newCampaignStatsService(&fakeCampaignRepo{}).CampaignStats(context.Background(), CampaignQuery{TenantID: 1, CampaignID: 1})
	require.NoError(t, err)
	assert.NotNil(t, st.Channels)
	assert.NotNil(t, st.Referrers)
	assert.Len(t, st.Daily, DefaultDays)
}

func TestCampaignStatsRejectsBadRanges(t *testing.T) {
	s := newCampaignStatsService(&fakeCampaignRepo{})
	_, err := s.CampaignStats(context.Background(), CampaignQuery{TenantID: 1, CampaignID: 1, From: date("2026-03-05"), To: date("2026-03-01")})
	assert.ErrorIs(t, err, ErrInvalidRange)
}

func TestCampaignStatsPropagatesRepositoryErrors(t *testing.T) {
	_, err := newCampaignStatsService(&fakeCampaignRepo{err: ErrCampaignNotFound}).CampaignStats(context.Background(), CampaignQuery{TenantID: 1, CampaignID: 1})
	assert.ErrorIs(t, err, ErrCampaignNotFound)
}

func TestCampaignStatsNeedsTheCampaignRepository(t *testing.T) {
	_, err := newStatsService(&fakeStatsRepo{}).CampaignStats(context.Background(), CampaignQuery{TenantID: 1, CampaignID: 1})
	assert.ErrorIs(t, err, ErrCampaignsDisabled)
}

func TestCampaignStatsCountsInTheRequestedTimeZone(t *testing.T) {
	lima := mustLocation(t, "America/Lima")
	repo := &fakeCampaignRepo{}
	_, err := newCampaignStatsService(repo).CampaignStats(context.Background(), CampaignQuery{TenantID: 1, CampaignID: 1, From: date("2026-03-01"), To: date("2026-03-02"), Location: lima})
	require.NoError(t, err)

	assert.Equal(t, time.Date(2026, 3, 1, 5, 0, 0, 0, time.UTC), repo.got.from.UTC())
	assert.Equal(t, time.Date(2026, 3, 3, 5, 0, 0, 0, time.UTC), repo.got.to.UTC())
	assert.Same(t, lima, repo.got.loc)
	assert.Equal(t, time.Date(2026, 2, 27, 5, 0, 0, 0, time.UTC), repo.previousFrom.UTC())
}
