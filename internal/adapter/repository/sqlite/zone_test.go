package sqlite

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
)

func loadZone(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	require.NoError(t, err)
	return loc
}

func TestZoneShift(t *testing.T) {
	from := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC)

	assert.Equal(t, `'+0 seconds'`, zoneShift(nil, from, to), "no zone is UTC")
	assert.Equal(t, `'+0 seconds'`, zoneShift(time.UTC, from, to))
	assert.Equal(t, `'-18000 seconds'`, zoneShift(loadZone(t, "America/Lima"), from, to), "a zone without daylight saving has one offset")

	ny := loadZone(t, "America/New_York")
	assert.Equal(t, `'-18000 seconds'`, zoneShift(ny, from, time.Date(2026, 3, 8, 7, 0, 0, 0, time.UTC)), "before the change the whole window is EST")
	assert.Equal(t, `'-14400 seconds'`, zoneShift(ny, time.Date(2026, 3, 9, 0, 0, 0, 0, time.UTC), to), "after it, EDT")
	assert.Equal(t,
		`CASE WHEN clicked_at < '2026-03-08T07:00:00.000Z' THEN '-18000 seconds' ELSE '-14400 seconds' END`,
		zoneShift(ny, from, to), "clocks go forward at 02:00 EST = 07:00 UTC on 8 March 2026")

	autumn := zoneShift(ny, time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC))
	assert.Equal(t, `CASE WHEN clicked_at < '2026-11-01T06:00:00.000Z' THEN '-14400 seconds' ELSE '-18000 seconds' END`, autumn)

	year := zoneShift(ny, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC))
	assert.Equal(t, 2, countOf(year, "WHEN"), "a year has two transitions: three segments")
}

func countOf(s, sub string) int {
	n := 0
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			n++
		}
	}
	return n
}

func TestClickRepositoryStatsInATimeZone(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	links := NewLinkRepository(db)
	clicks := NewClickRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)
	mine, err := links.Create(ctx, link.Link{Code: "zone000", OriginURL: "https://example.com/z", TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)
	add := func(when time.Time) {
		_, err := clicks.Create(ctx, analytics.Click{LinkID: mine.ID, At: when})
		require.NoError(t, err)
	}
	utc := func(y int, m time.Month, d, h, min int) time.Time { return time.Date(y, m, d, h, min, 0, 0, time.UTC) }

	t.Run("Lima has no daylight saving", func(t *testing.T) {
		lima := loadZone(t, "America/Lima")
		add(utc(2026, 5, 2, 4, 59)) // 23:59 on 1 May in Lima
		add(utc(2026, 5, 2, 5, 0))  // 00:00 on 2 May
		add(utc(2026, 5, 2, 16, 0)) // 11:00 on 2 May: the click that showed up at 16
		from, to := utc(2026, 5, 1, 5, 0), utc(2026, 5, 3, 5, 0)

		st, err := clicks.Stats(ctx, 1, mine.ID, from, to, lima, analytics.Filter{})
		require.NoError(t, err)
		assert.Equal(t, []analytics.DayCount{{Date: "2026-05-01", Clicks: 1}, {Date: "2026-05-02", Clicks: 2}}, st.Daily)
		assert.EqualValues(t, 1, st.ByHour[23])
		assert.EqualValues(t, 1, st.ByHour[0])
		assert.EqualValues(t, 1, st.ByHour[11])
		assert.EqualValues(t, 0, st.ByHour[16])
		assert.Equal(t, []int64{0, 0, 0, 0, 0, 1, 2}, st.ByWeekday, "1 May 2026 is a Friday (1 click), 2 May a Saturday (2)")
	})

	t.Run("a daylight saving change inside the window", func(t *testing.T) {
		ny := loadZone(t, "America/New_York")
		add(utc(2026, 3, 8, 4, 30))                               // 23:30 on 7 March, EST
		add(utc(2026, 3, 8, 6, 59))                               // 01:59 on 8 March, EST, the last minute before the change
		add(utc(2026, 3, 8, 7, 0))                                // 03:00 on 8 March, EDT: the clocks skipped 02:00
		add(utc(2026, 3, 9, 3, 59))                               // 23:59 on 8 March, EDT
		add(utc(2026, 3, 9, 4, 0))                                // 00:00 on 9 March, EDT
		from, to := utc(2026, 3, 7, 5, 0), utc(2026, 3, 10, 4, 0) // 7 to 9 March, local midnights

		st, err := clicks.Stats(ctx, 1, mine.ID, from, to, ny, analytics.Filter{})
		require.NoError(t, err)
		assert.Equal(t, []analytics.DayCount{{Date: "2026-03-07", Clicks: 1}, {Date: "2026-03-08", Clicks: 3}, {Date: "2026-03-09", Clicks: 1}}, st.Daily)
		for hour, want := range map[int]int64{23: 2, 1: 1, 3: 1, 0: 1} {
			assert.Equal(t, want, st.ByHour[hour], "hour %d", hour)
		}
	})

	t.Run("UTC is unchanged", func(t *testing.T) {
		st, err := clicks.Stats(ctx, 1, mine.ID, utc(2026, 5, 2, 0, 0), utc(2026, 5, 3, 0, 0), time.UTC, analytics.Filter{})
		require.NoError(t, err)
		assert.Equal(t, []analytics.DayCount{{Date: "2026-05-02", Clicks: 3}}, st.Daily)
		assert.EqualValues(t, 1, st.ByHour[16])
	})
}
