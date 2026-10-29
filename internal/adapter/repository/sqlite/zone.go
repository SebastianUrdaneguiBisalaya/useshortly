package sqlite

import (
	"fmt"
	"strings"
	"time"
)

// zoneShift is the SQLite date modifier that moves a stored UTC timestamp to the wall-clock time of loc, as an SQL
// expression to use as the last argument of strftime/datetime, e.g. `'-18000 seconds'`.
//
// The UTC offset of a zone can change inside a window (daylight saving), and every click must use the offset that applied
// when it happened. The window from..to is cut at the zone's transitions (Time.ZoneBounds) and, when there is more than
// one segment, the expression is a CASE choosing the offset by the click's UTC time. Only integers and timestamps
// formatted by this package are written into the SQL, never user input.
func zoneShift(loc *time.Location, from, to time.Time) string {
	if loc == nil {
		loc = time.UTC
	}
	type segment struct {
		until  time.Time // exclusive end, zero for the last one
		offset int
	}
	var segments []segment
	for t := from; ; {
		local := t.In(loc)
		_, offset := local.Zone()
		_, end := local.ZoneBounds()
		if end.IsZero() || !end.Before(to) {
			segments = append(segments, segment{offset: offset})
			break
		}
		segments = append(segments, segment{until: end, offset: offset})
		t = end
	}
	if len(segments) == 1 {
		return modifier(segments[0].offset)
	}
	var b strings.Builder
	b.WriteString("CASE")
	for _, s := range segments[:len(segments)-1] {
		fmt.Fprintf(&b, " WHEN clicked_at < '%s' THEN %s", formatTime(s.until), modifier(s.offset))
	}
	fmt.Fprintf(&b, " ELSE %s END", modifier(segments[len(segments)-1].offset))
	return b.String()
}

func modifier(offsetSeconds int) string { return fmt.Sprintf("'%+d seconds'", offsetSeconds) }
