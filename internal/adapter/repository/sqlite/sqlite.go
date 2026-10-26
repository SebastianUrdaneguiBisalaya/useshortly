// Package sqlite implements the domain repositories on database/sql (SQLite/Turso).
package sqlite

import (
	"database/sql"
	"strings"
	"time"
)

// SQLite stores timestamps as UTC ISO-8601 text (see migrations).
const timeLayout = "2006-01-02T15:04:05.000Z"

func formatTime(t time.Time) string { return t.UTC().Format(timeLayout) }

func parseTime(s string) (time.Time, error) { return time.Parse(time.RFC3339Nano, s) }

func parseNullTime(s sql.NullString) (*time.Time, error) {
	if !s.Valid {
		return nil, nil
	}
	t, err := parseTime(s.String)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return formatTime(*t)
}

func nullInt64(n *int64) any {
	if n == nil {
		return nil
	}
	return *n
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}
