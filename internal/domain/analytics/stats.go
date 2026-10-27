package analytics

import (
	"context"
	"time"
)

const (
	// DefaultDays is the window when no dates are given, ending today.
	DefaultDays = 30
	// MaxDays is the longest window a query may ask for.
	MaxDays = 366
	// TopN is how many referrers, countries and devices are listed.
	TopN = 10

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
	LinkID    int64
	From      string // YYYY-MM-DD
	To        string // YYYY-MM-DD
	Total     int64
	Daily     []DayCount // one entry per day, zero days included
	Referrers []Count
	Countries []Count
	Devices   []Count
}

// StatsQuery selects a link of a tenant and a window. From and To are days (their time of day
// is ignored); zero values mean "the last DefaultDays days, ending today".
type StatsQuery struct {
	TenantID int64
	LinkID   int64
	From     time.Time
	To       time.Time
}

// StatsRepository answers the questions Service.Stats asks about stored clicks.
type StatsRepository interface {
	// Stats aggregates the clicks of the link with from <= at < to, newest-first lists capped at
	// TopN, and Daily only for the days that have clicks. Names are as stored, "" meaning absent.
	// Returns ErrNotFound if the link does not exist in that tenant.
	Stats(ctx context.Context, tenantID, linkID int64, from, to time.Time) (Stats, error)
}

type Service struct {
	repo StatsRepository
	now  func() time.Time
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
	// The repository takes a half-open range, so "to" includes its whole last day.
	st, err := s.repo.Stats(ctx, q.TenantID, q.LinkID, from, to.AddDate(0, 0, 1))
	if err != nil {
		return Stats{}, err
	}
	st.LinkID = q.LinkID
	st.From, st.To = from.Format(dateLayout), to.Format(dateLayout)
	st.Daily = fillDays(st.Daily, from, to)
	st.Referrers = label(st.Referrers, labelDirect)
	st.Countries = label(st.Countries, labelUnknown)
	st.Devices = label(st.Devices, labelUnknown)
	return st, nil
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
