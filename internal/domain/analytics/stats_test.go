package analytics

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeStatsRepo struct {
	got struct {
		tenant, link int64
		from, to     time.Time
		filter       Filter
		loc          *time.Location
	}
	calls        int
	result       Stats
	previous     int64
	previousFrom time.Time
	previousTo   time.Time
	err          error
}

func (f *fakeStatsRepo) Stats(_ context.Context, tenantID, linkID int64, from, to time.Time, loc *time.Location, flt Filter) (Stats, error) {
	f.calls++
	f.got.tenant, f.got.link, f.got.from, f.got.to, f.got.loc, f.got.filter = tenantID, linkID, from, to, loc, flt
	return f.result, f.err
}

func (f *fakeStatsRepo) Total(_ context.Context, _, _ int64, from, to time.Time, _ Filter) (int64, error) {
	f.previousFrom, f.previousTo = from, to
	return f.previous, f.err
}

func date(s string) time.Time {
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		panic(err)
	}
	return t
}

func newStatsService(repo StatsRepository) *Service {
	s := NewService(repo)
	s.now = func() time.Time { return time.Date(2026, 3, 10, 15, 30, 0, 0, time.UTC) }
	return s
}

func TestStatsFillsEveryDayOfTheWindow(t *testing.T) {
	repo := &fakeStatsRepo{result: Stats{
		Total: 5,
		Daily: []DayCount{{"2026-03-01", 2}, {"2026-03-03", 3}},
	}}
	st, err := newStatsService(repo).Stats(context.Background(),
		StatsQuery{TenantID: 4, LinkID: 9, From: date("2026-03-01"), To: date("2026-03-04")})
	require.NoError(t, err)

	assert.Equal(t, []DayCount{{"2026-03-01", 2}, {"2026-03-02", 0}, {"2026-03-03", 3}, {"2026-03-04", 0}}, st.Daily)
	assert.EqualValues(t, 9, st.LinkID)
	assert.Equal(t, "2026-03-01", st.From)
	assert.Equal(t, "2026-03-04", st.To)
	assert.EqualValues(t, 5, st.Total)

	assert.EqualValues(t, 4, repo.got.tenant)
	assert.EqualValues(t, 9, repo.got.link)
	assert.Equal(t, date("2026-03-01"), repo.got.from)
	assert.Equal(t, date("2026-03-05"), repo.got.to, "the repository gets a half-open range that includes the whole last day")
}

func TestStatsDefaultsToTheLastThirtyDaysEndingToday(t *testing.T) {
	repo := &fakeStatsRepo{}
	st, err := newStatsService(repo).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1})
	require.NoError(t, err)
	assert.Equal(t, "2026-03-10", st.To)
	assert.Equal(t, "2026-02-09", st.From)
	assert.Len(t, st.Daily, DefaultDays)
	assert.Equal(t, DayCount{"2026-03-10", 0}, st.Daily[len(st.Daily)-1])
}

func TestStatsKeepsOnlyTheDayOfTheDates(t *testing.T) {
	repo := &fakeStatsRepo{}
	from := time.Date(2026, 3, 1, 23, 59, 0, 0, time.FixedZone("UTC-5", -5*3600)) // already 04:59 on the 2nd in UTC
	st, err := newStatsService(repo).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1, From: from, To: date("2026-03-02")})
	require.NoError(t, err)
	assert.Equal(t, "2026-03-02", st.From)
	assert.Len(t, st.Daily, 1)
}

func TestStatsRejectsBadRanges(t *testing.T) {
	tests := []struct {
		name     string
		from, to time.Time
		ok       bool
	}{
		{"from after to", date("2026-03-05"), date("2026-03-01"), false},
		{"one day", date("2026-03-05"), date("2026-03-05"), true},
		{"exactly the maximum", date("2025-03-10"), date("2026-03-10"), true},
		{"one day over the maximum", date("2025-03-09"), date("2026-03-10"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeStatsRepo{}
			_, err := newStatsService(repo).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1, From: tt.from, To: tt.to})
			if tt.ok {
				assert.NoError(t, err)
				return
			}
			assert.ErrorIs(t, err, ErrInvalidRange)
			assert.Zero(t, repo.calls, "the repository is not asked")
		})
	}
}

func TestStatsNamesMissingValues(t *testing.T) {
	repo := &fakeStatsRepo{result: Stats{
		Referrers: []Count{{"", 4}, {"https://news.example/a", 2}},
		Countries: []Count{{"PE", 5}, {"", 1}},
		Devices:   []Count{{"", 3}},
	}}
	st, err := newStatsService(repo).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1})
	require.NoError(t, err)
	assert.Equal(t, []Count{{"direct", 4}, {"https://news.example/a", 2}}, st.Referrers)
	assert.Equal(t, []Count{{"PE", 5}, {"unknown", 1}}, st.Countries)
	assert.Equal(t, []Count{{"unknown", 3}}, st.Devices)
}

func TestStatsListsAreNeverNil(t *testing.T) {
	st, err := newStatsService(&fakeStatsRepo{}).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1})
	require.NoError(t, err)
	assert.NotNil(t, st.Referrers)
	assert.NotNil(t, st.Countries)
	assert.NotNil(t, st.Devices)
}

func TestStatsPropagatesRepositoryErrors(t *testing.T) {
	_, err := newStatsService(&fakeStatsRepo{err: ErrNotFound}).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1})
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestStatsComparesWithThePreviousPeriod(t *testing.T) {
	repo := &fakeStatsRepo{previous: 7}
	st, err := newStatsService(repo).Stats(context.Background(),
		StatsQuery{TenantID: 1, LinkID: 1, From: date("2026-03-05"), To: date("2026-03-07")})
	require.NoError(t, err)
	assert.EqualValues(t, 7, st.PreviousTotal)
	assert.Equal(t, date("2026-03-02"), repo.previousFrom, "same length, right before")
	assert.Equal(t, date("2026-03-05"), repo.previousTo)
}

func TestStatsPadsHoursAndWeekdays(t *testing.T) {
	st, err := newStatsService(&fakeStatsRepo{result: Stats{ByHour: []int64{1}}}).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1})
	require.NoError(t, err)
	assert.Len(t, st.ByHour, 24)
	assert.Len(t, st.ByWeekday, 7)
	assert.EqualValues(t, 1, st.ByHour[0])
}

func TestStatsTurnsLabelsBackIntoStoredValues(t *testing.T) {
	str := func(s string) *string { return &s }
	tests := []struct {
		name string
		q    StatsQuery
		want Filter
	}{
		{"none", StatsQuery{}, Filter{}},
		{"country is upper-cased", StatsQuery{Country: "pe"}, Filter{Country: str("PE")}},
		{"unknown country", StatsQuery{Country: "unknown"}, Filter{Country: str("")}},
		{"device is lower-cased", StatsQuery{Device: "Mobile"}, Filter{Device: str("mobile")}},
		{"direct visits", StatsQuery{Referrer: "direct"}, Filter{Referrer: str("")}},
		{"a referrer as is", StatsQuery{Referrer: "https://a.example"}, Filter{Referrer: str("https://a.example")}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeStatsRepo{}
			tt.q.TenantID, tt.q.LinkID = 1, 1
			_, err := newStatsService(repo).Stats(context.Background(), tt.q)
			require.NoError(t, err)
			assert.Equal(t, tt.want, repo.got.filter)
		})
	}
}

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	require.NoError(t, err)
	return loc
}

func TestStatsCountsDaysInTheRequestedTimeZone(t *testing.T) {
	lima := mustLocation(t, "America/Lima")
	repo := &fakeStatsRepo{}
	// 02:00 UTC on the 10th is still the evening of the 9th in Lima.
	s := newStatsService(repo)
	s.now = func() time.Time { return time.Date(2026, 3, 10, 2, 0, 0, 0, time.UTC) }

	st, err := s.Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1, From: date("2026-03-08"), Location: lima})
	require.NoError(t, err)

	assert.Equal(t, "2026-03-08", st.From)
	assert.Equal(t, "2026-03-09", st.To, "today is the date it is in the zone, not in UTC")
	assert.Equal(t, DayCount{"2026-03-09", 0}, st.Daily[len(st.Daily)-1])
	assert.Equal(t, time.Date(2026, 3, 8, 5, 0, 0, 0, time.UTC), repo.got.from.UTC(), "a Lima day starts at 05:00 UTC")
	assert.Equal(t, time.Date(2026, 3, 10, 5, 0, 0, 0, time.UTC), repo.got.to.UTC())
	assert.Same(t, lima, repo.got.loc, "the repository buckets in the same zone")
}

func TestStatsDefaultsToUTCWithoutALocation(t *testing.T) {
	repo := &fakeStatsRepo{}
	_, err := newStatsService(repo).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1, From: date("2026-03-01"), To: date("2026-03-02")})
	require.NoError(t, err)
	assert.Equal(t, time.UTC, repo.got.loc)
}

func TestStatsWindowAcrossADaylightSavingChange(t *testing.T) {
	ny := mustLocation(t, "America/New_York")
	repo := &fakeStatsRepo{}

	// Clocks go forward on 8 March 2026, so that local day has 23 hours.
	st, err := newStatsService(repo).Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1, From: date("2026-03-07"), To: date("2026-03-09"), Location: ny})
	require.NoError(t, err)

	assert.Equal(t, []DayCount{{"2026-03-07", 0}, {"2026-03-08", 0}, {"2026-03-09", 0}}, st.Daily, "every local day is listed once")
	assert.Equal(t, time.Date(2026, 3, 7, 5, 0, 0, 0, time.UTC), repo.got.from.UTC(), "EST, UTC-5")
	assert.Equal(t, time.Date(2026, 3, 10, 4, 0, 0, 0, time.UTC), repo.got.to.UTC(), "EDT, UTC-4")
	assert.Equal(t, time.Date(2026, 3, 4, 5, 0, 0, 0, time.UTC), repo.previousFrom.UTC(), "the previous window is three whole local days back")
	assert.Equal(t, time.Date(2026, 3, 7, 5, 0, 0, 0, time.UTC), repo.previousTo.UTC())
}

func TestStatsRangeLimitIsCountedInDaysInAZone(t *testing.T) {
	ny := mustLocation(t, "America/New_York")
	s := newStatsService(&fakeStatsRepo{})

	_, err := s.Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1, From: date("2025-03-01"), To: date("2026-03-01"), Location: ny})
	require.NoError(t, err, "366 days is the longest window, even when a daylight saving change falls inside it")

	_, err = s.Stats(context.Background(), StatsQuery{TenantID: 1, LinkID: 1, From: date("2025-02-28"), To: date("2026-03-01"), Location: ny})
	assert.ErrorIs(t, err, ErrInvalidRange)
}

func TestLoadLocation(t *testing.T) {
	loc, err := LoadLocation("")
	require.NoError(t, err)
	assert.Equal(t, time.UTC, loc)

	loc, err = LoadLocation("America/Lima")
	require.NoError(t, err)
	assert.Equal(t, "America/Lima", loc.String())

	for _, name := range []string{"Mars/Olympus", "Local", "../etc/passwd", "lima"} {
		_, err = LoadLocation(name)
		assert.ErrorIs(t, err, ErrInvalidTimeZone, name)
	}
}
