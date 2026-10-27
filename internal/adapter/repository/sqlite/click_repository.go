package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
)

type ClickRepository struct {
	db *sql.DB
}

func NewClickRepository(db *sql.DB) *ClickRepository {
	return &ClickRepository{db: db}
}

func (r *ClickRepository) Create(ctx context.Context, c analytics.Click) (analytics.Click, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO clicks (link_id, clicked_at, referrer, user_agent, country, device)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		c.LinkID, formatTime(c.At), c.Referrer, c.UserAgent, c.Country, c.Device)
	if err != nil {
		return analytics.Click{}, fmt.Errorf("click repo: insert: %w", err)
	}
	if c.ID, err = res.LastInsertId(); err != nil {
		return analytics.Click{}, fmt.Errorf("click repo: id: %w", err)
	}
	return c, nil
}

// Stats implements analytics.StatsRepository.
func (r *ClickRepository) Stats(ctx context.Context, tenantID, linkID int64, from, to time.Time) (analytics.Stats, error) {
	var one int
	err := r.db.QueryRowContext(ctx, `SELECT 1 FROM links WHERE id = ? AND tenant_id = ?`, linkID, tenantID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return analytics.Stats{}, analytics.ErrNotFound
	}
	if err != nil {
		return analytics.Stats{}, fmt.Errorf("click repo: link: %w", err)
	}

	var st analytics.Stats
	window := `link_id = ? AND clicked_at >= ? AND clicked_at < ?`
	args := []any{linkID, formatTime(from), formatTime(to)}

	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM clicks WHERE `+window, args...).Scan(&st.Total); err != nil {
		return analytics.Stats{}, fmt.Errorf("click repo: total: %w", err)
	}

	rows, err := r.db.QueryContext(ctx,
		`SELECT substr(clicked_at, 1, 10), count(*) FROM clicks WHERE `+window+` GROUP BY 1 ORDER BY 1`, args...)
	if err != nil {
		return analytics.Stats{}, fmt.Errorf("click repo: daily: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d analytics.DayCount
		if err := rows.Scan(&d.Date, &d.Clicks); err != nil {
			return analytics.Stats{}, fmt.Errorf("click repo: daily: %w", err)
		}
		st.Daily = append(st.Daily, d)
	}
	if err := rows.Err(); err != nil {
		return analytics.Stats{}, fmt.Errorf("click repo: daily: %w", err)
	}

	if st.Referrers, err = r.top(ctx, "referrer", window, args); err != nil {
		return analytics.Stats{}, err
	}
	if st.Countries, err = r.top(ctx, "country", window, args); err != nil {
		return analytics.Stats{}, err
	}
	if st.Devices, err = r.top(ctx, "device", window, args); err != nil {
		return analytics.Stats{}, err
	}
	return st, nil
}

// top lists the most frequent values of a column. column is one of this file's own constants,
// never user input.
func (r *ClickRepository) top(ctx context.Context, column, window string, args []any) ([]analytics.Count, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+column+`, count(*) AS n FROM clicks WHERE `+window+
			` GROUP BY 1 ORDER BY n DESC, 1 LIMIT ?`, append(args[:len(args):len(args)], analytics.TopN)...)
	if err != nil {
		return nil, fmt.Errorf("click repo: top %s: %w", column, err)
	}
	defer rows.Close()
	var out []analytics.Count
	for rows.Next() {
		var c analytics.Count
		if err := rows.Scan(&c.Name, &c.Clicks); err != nil {
			return nil, fmt.Errorf("click repo: top %s: %w", column, err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
