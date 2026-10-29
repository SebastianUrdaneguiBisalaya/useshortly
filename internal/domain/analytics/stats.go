package analytics

import (
	"context"
	"strings"
	"time"
)

const (
	// DefaultDays is the window when no dates are given, ending today.
	DefaultDays = 30
	// MaxDays is the longest window a query may ask for.
	MaxDays = 366
	// TopN is how many referrers and devices are listed.
	TopN = 10
	// MaxCountries is how many countries are listed: all of them, so a map can paint each one.
	MaxCountries = 250

	dateLayout   = "2006-01-02"
	labelDirect  = "direct"
	labelUnknown = "unknown"
)

// Count is how many clicks one referrer, country or device brought.
type Count struct {
	Name   string
	Clicks int64
}

// DayCount is the clicks of one UTC day.
type DayCount struct {
	Date   string // YYYY-MM-DD
	Clicks int64
}

// Stats summarizes the clicks of a link between two days, both included.
type Stats struct {
	LinkID int64
	From   string // YYYY-MM-DD
	To     string // YYYY-MM-DD
	Total  int64
	// PreviousTotal is the clicks of the window right before this one, as long as it, with the
	// same filter, to compare against Total.
	PreviousTotal int64
	Daily         []DayCount // one entry per day, zero days included
	// ByHour has 24 entries (UTC hour 0..23) and ByWeekday 7 (0 is Sunday), zeros included.
	ByHour    []int64
	ByWeekday []int64
	Referrers []Count
	Countries []Count
	Devices   []Count
}

// Filter narrows the clicks counted. A nil field does not filter; a pointer to "" selects the
// clicks that came without a value (direct visits, unknown country or device).
type Filter struct {
	Country  *string
	Device   *string
	Referrer *string
}

// StatsQuery selects a link of a tenant and a window. From and To are days (their time of day
// is ignored); zero values mean "the last DefaultDays days, ending today".
type StatsQuery struct {
	TenantID int64
	LinkID   int64
	From     time.Time
	To       time.Time
	// Country, Device and Referrer keep only the clicks with that value, written as the lists
	// return them: "direct" is a visit without referrer and "unknown" a missing country or device.
	// Empty does not filter.
	Country  string
	Device   string
	Referrer string
}

// StatsRepository answers the questions Service.Stats asks about stored clicks.
type StatsRepository interface {
	// Stats aggregates the clicks of the link with from <= at < to that pass the filter. Referrers
	// and Devices are capped at TopN and Countries at MaxCountries, most frequent first; Daily
	// has only the days with clicks and ByHour and ByWeekday only the hours and weekdays with
	// clicks (index = hour or weekday). Names are as stored, "" meaning absent.
	// Returns ErrNotFound if the link does not exist in that tenant.
	Stats(ctx context.Context, tenantID, linkID int64, from, to time.Time, f Filter) (Stats, error)
	// Total counts the clicks of the link with from <= at < to that pass the filter.
	Total(ctx context.Context, tenantID, linkID int64, from, to time.Time, f Filter) (int64, error)
}

// ChannelCount is how many clicks one channel of a campaign brought.
type ChannelCount struct {
	ID     int64
	Name   string
	Clicks int64
}

// CampaignStats summarizes the clicks of every link of a campaign between two days, both included.
// The embedded Stats has no LinkID; Channels lists every channel of the campaign, most clicks
// first, the ones without clicks included.
type CampaignStats struct {
	Stats
	CampaignID int64
	Channels   []ChannelCount
}

// CampaignQuery selects a campaign of a tenant and a window, with the same meaning as in StatsQuery.
type CampaignQuery struct {
	TenantID   int64
	CampaignID int64
	From       time.Time
	To         time.Time
	Country    string
	Device     string
	Referrer   string
}

// CampaignStatsRepository answers the questions Service.CampaignStats asks about stored clicks.
type CampaignStatsRepository interface {
	// CampaignStats aggregates the clicks of every link in a channel of the campaign, like
	// StatsRepository.Stats does for one link, and counts them per channel of the campaign.
	// Returns ErrCampaignNotFound if the campaign does not exist in that tenant.
	CampaignStats(ctx context.Context, tenantID, campaignID int64, from, to time.Time, f Filter) (Stats, []ChannelCount, error)
	// CampaignTotal counts the clicks of the campaign with from <= at < to that pass the filter.
	CampaignTotal(ctx context.Context, tenantID, campaignID int64, from, to time.Time, f Filter) (int64, error)
}

type Service struct {
	repo      StatsRepository
	campaigns CampaignStatsRepository
	now       func() time.Time
}

// WithCampaigns enables CampaignStats.
func (s *Service) WithCampaigns(r CampaignStatsRepository) *Service {
	s.campaigns = r
	return s
}

func NewService(repo StatsRepository) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// Stats returns the clicks of a link of the tenant over the window.
func (s *Service) Stats(ctx context.Context, q StatsQuery) (Stats, error) {
	from, to, err := s.window(q.From, q.To)
	if err != nil {
		return Stats{}, err
	}
	f := filter(q)
	// The repository takes a half-open range, so "to" includes its whole last day.
	end := to.AddDate(0, 0, 1)
	st, err := s.repo.Stats(ctx, q.TenantID, q.LinkID, from, end, f)
	if err != nil {
		return Stats{}, err
	}
	span := end.Sub(from)
	if st.PreviousTotal, err = s.repo.Total(ctx, q.TenantID, q.LinkID, from.Add(-span), from, f); err != nil {
		return Stats{}, err
	}
	st.LinkID = q.LinkID
	return finish(st, from, to), nil
}

// CampaignStats returns the clicks of every link of a campaign of the tenant over the window.
func (s *Service) CampaignStats(ctx context.Context, q CampaignQuery) (CampaignStats, error) {
	if s.campaigns == nil {
		return CampaignStats{}, ErrCampaignsDisabled
	}
	from, to, err := s.window(q.From, q.To)
	if err != nil {
		return CampaignStats{}, err
	}
	f := filter(StatsQuery{Country: q.Country, Device: q.Device, Referrer: q.Referrer})
	end := to.AddDate(0, 0, 1)
	st, channels, err := s.campaigns.CampaignStats(ctx, q.TenantID, q.CampaignID, from, end, f)
	if err != nil {
		return CampaignStats{}, err
	}
	span := end.Sub(from)
	if st.PreviousTotal, err = s.campaigns.CampaignTotal(ctx, q.TenantID, q.CampaignID, from.Add(-span), from, f); err != nil {
		return CampaignStats{}, err
	}
	if channels == nil {
		channels = []ChannelCount{}
	}
	return CampaignStats{Stats: finish(st, from, to), CampaignID: q.CampaignID, Channels: channels}, nil
}

// finish completes what a repository returned: the window it covers, every day, hour and weekday
// present, and a label for the clicks that came without a value.
func finish(st Stats, from, to time.Time) Stats {
	st.From, st.To = from.Format(dateLayout), to.Format(dateLayout)
	st.Daily = fillDays(st.Daily, from, to)
	st.ByHour = pad(st.ByHour, 24)
	st.ByWeekday = pad(st.ByWeekday, 7)
	st.Referrers = label(st.Referrers, labelDirect)
	st.Countries = label(st.Countries, labelUnknown)
	st.Devices = label(st.Devices, labelUnknown)
	return st
}

// window resolves the optional days into from <= to, both at midnight UTC.
func (s *Service) window(from, to time.Time) (time.Time, time.Time, error) {
	if to.IsZero() {
		to = s.now()
	}
	to = day(to)
	if from.IsZero() {
		from = to.AddDate(0, 0, -(DefaultDays - 1))
	}
	from = day(from)
	if from.After(to) || to.Sub(from) >= MaxDays*24*time.Hour {
		return time.Time{}, time.Time{}, ErrInvalidRange
	}
	return from, to, nil
}

// filter turns the labels the lists use back into what is stored.
func filter(q StatsQuery) Filter {
	var f Filter
	if q.Country != "" {
		f.Country = stored(strings.ToUpper(q.Country), labelUnknown)
	}
	if q.Device != "" {
		f.Device = stored(strings.ToLower(q.Device), labelUnknown)
	}
	if q.Referrer != "" {
		f.Referrer = stored(q.Referrer, labelDirect)
	}
	return f
}

func stored(v, empty string) *string {
	if strings.EqualFold(v, empty) {
		v = ""
	}
	return &v
}

// pad returns exactly n counts, zero where the repository had none.
func pad(have []int64, n int) []int64 {
	out := make([]int64, n)
	copy(out, have)
	return out
}

func day(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// fillDays returns every day from..to, taking the counts the repository had.
func fillDays(have []DayCount, from, to time.Time) []DayCount {
	counts := make(map[string]int64, len(have))
	for _, d := range have {
		counts[d.Date] = d.Clicks
	}
	var out []DayCount
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		date := d.Format(dateLayout)
		out = append(out, DayCount{Date: date, Clicks: counts[date]})
	}
	return out
}

// label names the clicks that came without a value, and never returns nil so it encodes as [].
func label(in []Count, empty string) []Count {
	out := make([]Count, 0, len(in))
	for _, c := range in {
		if c.Name == "" {
			c.Name = empty
		}
		out = append(out, c)
	}
	return out
}
