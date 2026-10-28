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
func (r *ClickRepository) Stats(ctx context.Context, tenantID, linkID int64, from, to time.Time, f analytics.Filter) (analytics.Stats, error) {
	if err := r.checkLink(ctx, tenantID, linkID); err != nil {
		return analytics.Stats{}, err
	}

	var st analytics.Stats
	window, args := clickWindow(linkID, from, to, f)

	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM clicks WHERE `+window, args...).Scan(&st.Total); err != nil {
		return analytics.Stats{}, fmt.Errorf("click repo: total: %w", err)
	}

	var err error
	if st.Daily, err = r.daily(ctx, window, args); err != nil {
		return analytics.Stats{}, err
	}
	if st.ByHour, err = r.bucketed(ctx, "hour", `CAST(substr(clicked_at, 12, 2) AS INTEGER)`, 24, window, args); err != nil {
		return analytics.Stats{}, err
	}
	if st.ByWeekday, err = r.bucketed(ctx, "weekday", `CAST(strftime('%w', substr(clicked_at, 1, 10)) AS INTEGER)`, 7, window, args); err != nil {
		return analytics.Stats{}, err
	}
	if st.Referrers, err = r.top(ctx, "referrer", analytics.TopN, window, args); err != nil {
		return analytics.Stats{}, err
	}
	if st.Countries, err = r.top(ctx, "country", analytics.MaxCountries, window, args); err != nil {
		return analytics.Stats{}, err
	}
	if st.Devices, err = r.top(ctx, "device", analytics.TopN, window, args); err != nil {
		return analytics.Stats{}, err
	}
	return st, nil
}

// Total implements analytics.StatsRepository.
func (r *ClickRepository) Total(ctx context.Context, tenantID, linkID int64, from, to time.Time, f analytics.Filter) (int64, error) {
	if err := r.checkLink(ctx, tenantID, linkID); err != nil {
		return 0, err
	}
	window, args := clickWindow(linkID, from, to, f)
	var n int64
	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM clicks WHERE `+window, args...).Scan(&n); err != nil {
		return 0, fmt.Errorf("click repo: total: %w", err)
	}
	return n, nil
}

func (r *ClickRepository) checkLink(ctx context.Context, tenantID, linkID int64) error {
	var one int
	err := r.db.QueryRowContext(ctx, `SELECT 1 FROM links WHERE id = ? AND tenant_id = ?`, linkID, tenantID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return analytics.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("click repo: link: %w", err)
	}
	return nil
}

// clickWindow is the WHERE clause (and its arguments) of the clicks of a link between from and to
// that pass the filter. Only fixed column names are written into it; values travel as arguments.
func clickWindow(linkID int64, from, to time.Time, f analytics.Filter) (string, []any) {
	where := `link_id = ? AND clicked_at >= ? AND clicked_at < ?`
	args := []any{linkID, formatTime(from), formatTime(to)}
	for _, c := range []struct {
		column string
		value  *string
	}{{"country", f.Country}, {"device", f.Device}, {"referrer", f.Referrer}} {
		if c.value != nil {
			where += ` AND ` + c.column + ` = ?`
			args = append(args, *c.value)
		}
	}
	return where, args
}

func (r *ClickRepository) daily(ctx context.Context, window string, args []any) ([]analytics.DayCount, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT substr(clicked_at, 1, 10), count(*) FROM clicks WHERE `+window+` GROUP BY 1 ORDER BY 1`, args...)
	if err != nil {
		return nil, fmt.Errorf("click repo: daily: %w", err)
	}
	defer rows.Close()
	var out []analytics.DayCount
	for rows.Next() {
		var d analytics.DayCount
		if err := rows.Scan(&d.Date, &d.Clicks); err != nil {
			return nil, fmt.Errorf("click repo: daily: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// bucketed counts the clicks per value of an integer expression in 0..size-1; expr is one of this
// file's own constants, never user input.
func (r *ClickRepository) bucketed(ctx context.Context, name, expr string, size int, window string, args []any) ([]int64, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+expr+`, count(*) FROM clicks WHERE `+window+` GROUP BY 1`, args...)
	if err != nil {
		return nil, fmt.Errorf("click repo: %s: %w", name, err)
	}
	defer rows.Close()
	out := make([]int64, size)
	for rows.Next() {
		var i int
		var n int64
		if err := rows.Scan(&i, &n); err != nil {
			return nil, fmt.Errorf("click repo: %s: %w", name, err)
		}
		if i >= 0 && i < size {
			out[i] = n
		}
	}
	return out, rows.Err()
}

// top lists the most frequent values of a column. column is one of this file's own constants,
// never user input.
func (r *ClickRepository) top(ctx context.Context, column string, limit int, window string, args []any) ([]analytics.Count, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+column+`, count(*) AS n FROM clicks WHERE `+window+
			` GROUP BY 1 ORDER BY n DESC, 1 LIMIT ?`, append(args[:len(args):len(args)], limit)...)
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
