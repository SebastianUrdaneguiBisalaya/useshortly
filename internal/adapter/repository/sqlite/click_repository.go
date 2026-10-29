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
	window, args := clickWindow(linkID, from, to, f)
	return r.aggregate(ctx, window, args)
}

// aggregate summarizes the clicks a WHERE clause selects.
func (r *ClickRepository) aggregate(ctx context.Context, window string, args []any) (analytics.Stats, error) {
	var st analytics.Stats
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

// CampaignStats implements analytics.CampaignStatsRepository.
func (r *ClickRepository) CampaignStats(ctx context.Context, tenantID, campaignID int64, from, to time.Time, f analytics.Filter) (analytics.Stats, []analytics.ChannelCount, error) {
	if err := r.checkCampaign(ctx, tenantID, campaignID); err != nil {
		return analytics.Stats{}, nil, err
	}
	window, args := scopedWindow(campaignClicks, []any{campaignID}, from, to, f)
	st, err := r.aggregate(ctx, window, args)
	if err != nil {
		return analytics.Stats{}, nil, err
	}
	channels, err := r.channelCounts(ctx, campaignID, from, to, f)
	if err != nil {
		return analytics.Stats{}, nil, err
	}
	return st, channels, nil
}

// CampaignTotal implements analytics.CampaignStatsRepository.
func (r *ClickRepository) CampaignTotal(ctx context.Context, tenantID, campaignID int64, from, to time.Time, f analytics.Filter) (int64, error) {
	if err := r.checkCampaign(ctx, tenantID, campaignID); err != nil {
		return 0, err
	}
	window, args := scopedWindow(campaignClicks, []any{campaignID}, from, to, f)
	var n int64
	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM clicks WHERE `+window, args...).Scan(&n); err != nil {
		return 0, fmt.Errorf("click repo: campaign total: %w", err)
	}
	return n, nil
}

// channelCounts counts the clicks per channel of a campaign, the channels without clicks included.
func (r *ClickRepository) channelCounts(ctx context.Context, campaignID int64, from, to time.Time, f analytics.Filter) ([]analytics.ChannelCount, error) {
	on := `k.link_id = l.id AND k.clicked_at >= ? AND k.clicked_at < ?`
	args := []any{formatTime(from), formatTime(to)}
	for _, c := range []struct {
		column string
		value  *string
	}{{"country", f.Country}, {"device", f.Device}, {"referrer", f.Referrer}} {
		if c.value != nil {
			on += ` AND k.` + c.column + ` = ?`
			args = append(args, *c.value)
		}
	}
	args = append(args, campaignID)
	rows, err := r.db.QueryContext(ctx,
		`SELECT ch.id, ch.name, count(k.id) AS n
		 FROM channels ch
		 LEFT JOIN links l ON l.channel_id = ch.id
		 LEFT JOIN clicks k ON `+on+`
		 WHERE ch.campaign_id = ?
		 GROUP BY ch.id, ch.name ORDER BY n DESC, ch.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("click repo: channels: %w", err)
	}
	defer rows.Close()
	var out []analytics.ChannelCount
	for rows.Next() {
		var c analytics.ChannelCount
		if err := rows.Scan(&c.ID, &c.Name, &c.Clicks); err != nil {
			return nil, fmt.Errorf("click repo: channels: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *ClickRepository) checkCampaign(ctx context.Context, tenantID, campaignID int64) error {
	var one int
	err := r.db.QueryRowContext(ctx, `SELECT 1 FROM campaigns WHERE id = ? AND tenant_id = ?`, campaignID, tenantID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return analytics.ErrCampaignNotFound
	}
	if err != nil {
		return fmt.Errorf("click repo: campaign: %w", err)
	}
	return nil
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
	return scopedWindow(`link_id = ?`, []any{linkID}, from, to, f)
}

// campaignClicks selects the clicks of every link in a channel of one campaign.
const campaignClicks = `link_id IN (SELECT l.id FROM links l JOIN channels ch ON ch.id = l.channel_id WHERE ch.campaign_id = ?)`

// scopedWindow is clickWindow for any scope condition (one of this file's own constants, never user
// input) with its arguments.
func scopedWindow(scope string, scopeArgs []any, from, to time.Time, f analytics.Filter) (string, []any) {
	where := scope + ` AND clicked_at >= ? AND clicked_at < ?`
	args := append(scopeArgs[:len(scopeArgs):len(scopeArgs)], formatTime(from), formatTime(to))
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
