package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type LinkRepository struct {
	db *sql.DB
}

func NewLinkRepository(db *sql.DB) *LinkRepository {
	return &LinkRepository{db: db}
}

func (r *LinkRepository) Create(ctx context.Context, l link.Link) (link.Link, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO links (code, origin_url, expires_at, max_clicks, password_hash, tenant_id, domain_id, channel_id, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		l.Code, l.OriginURL, nullTime(l.ExpiresAt), nullInt64(l.MaxClicks), nullString(l.PasswordHash), l.TenantID, nullInt64(l.DomainID), nullInt64(l.ChannelID), l.CreatedBy, formatTime(l.CreatedAt))
	if isUniqueViolation(err) {
		return link.Link{}, link.ErrCodeTaken
	}
	if err != nil {
		return link.Link{}, fmt.Errorf("link repo: insert: %w", err)
	}
	if l.ID, err = res.LastInsertId(); err != nil {
		return link.Link{}, fmt.Errorf("link repo: id: %w", err)
	}
	if l.DomainID != nil {
		if err := r.db.QueryRowContext(ctx, `SELECT host FROM domains WHERE id = ?`, *l.DomainID).Scan(&l.DomainHost); err != nil {
			return link.Link{}, fmt.Errorf("link repo: domain host: %w", err)
		}
	}
	if l.ChannelID != nil {
		var campaignID int64
		if err := r.db.QueryRowContext(ctx, `SELECT campaign_id FROM channels WHERE id = ?`, *l.ChannelID).Scan(&campaignID); err != nil {
			return link.Link{}, fmt.Errorf("link repo: campaign: %w", err)
		}
		l.CampaignID = &campaignID
	}
	return l, nil
}

// linkSelect reads a link with the host of its domain and the campaign of its channel, if it has them.
const linkSelect = `SELECT l.id, l.code, l.origin_url, l.expires_at, l.max_clicks, l.click_count, l.password_hash,
	l.tenant_id, l.domain_id, d.host, l.channel_id, ch.campaign_id, l.qr_foreground, l.qr_background, l.qr_logo_url, l.created_by, l.updated_by, l.created_at, l.updated_at
	FROM links l JOIN organizations o ON o.id = l.tenant_id AND o.deleted_at IS NULL
	LEFT JOIN domains d ON d.id = l.domain_id
	LEFT JOIN channels ch ON ch.id = l.channel_id `

// scanLink reads a row selected with linkColumns from a *sql.Row or *sql.Rows.
func scanLink(row interface{ Scan(...any) error }) (link.Link, error) {
	var (
		l                  link.Link
		expires, updated   sql.NullString
		passwordHash       sql.NullString
		updatedBy          sql.NullInt64
		createdBy          sql.NullInt64
		maxClicks          sql.NullInt64
		domainID           sql.NullInt64
		domainHost         sql.NullString
		channelID          sql.NullInt64
		campaignID         sql.NullInt64
		qrFg, qrBg, qrLogo sql.NullString
		createdAt          string
	)
	err := row.Scan(&l.ID, &l.Code, &l.OriginURL, &expires, &maxClicks, &l.ClickCount, &passwordHash, &l.TenantID, &domainID, &domainHost, &channelID, &campaignID, &qrFg, &qrBg, &qrLogo, &createdBy, &updatedBy, &createdAt, &updated)
	if err != nil {
		return link.Link{}, err
	}
	if maxClicks.Valid {
		l.MaxClicks = &maxClicks.Int64
	}
	if domainID.Valid {
		l.DomainID = &domainID.Int64
	}
	l.DomainHost = domainHost.String
	if channelID.Valid {
		l.ChannelID = &channelID.Int64
	}
	if campaignID.Valid {
		l.CampaignID = &campaignID.Int64
	}
	l.QRStyle = link.QRStyle{Foreground: qrFg.String, Background: qrBg.String, LogoURL: qrLogo.String}
	l.CreatedBy = createdBy.Int64 // 0 once the user who created it was deleted
	l.PasswordHash = passwordHash.String
	if updatedBy.Valid {
		l.UpdatedBy = &updatedBy.Int64
	}
	if l.ExpiresAt, err = parseNullTime(expires); err != nil {
		return link.Link{}, fmt.Errorf("link repo: expires_at: %w", err)
	}
	if l.UpdatedAt, err = parseNullTime(updated); err != nil {
		return link.Link{}, fmt.Errorf("link repo: updated_at: %w", err)
	}
	if l.CreatedAt, err = parseTime(createdAt); err != nil {
		return link.Link{}, fmt.Errorf("link repo: created_at: %w", err)
	}
	return l, nil
}

func (r *LinkRepository) FindByCode(ctx context.Context, domainID *int64, code string) (link.Link, error) {
	l, err := scanLink(r.db.QueryRowContext(ctx, linkSelect+`WHERE l.code = ? AND COALESCE(l.domain_id, 0) = ?`, code, domainKey(domainID)))
	if errors.Is(err, sql.ErrNoRows) {
		return link.Link{}, link.ErrNotFound
	}
	if err != nil {
		return link.Link{}, fmt.Errorf("link repo: find: %w", err)
	}
	return l, nil
}

func (r *LinkRepository) FindByID(ctx context.Context, tenantID, id int64) (link.Link, error) {
	l, err := scanLink(r.db.QueryRowContext(ctx, linkSelect+`WHERE l.id = ? AND l.tenant_id = ?`, id, tenantID))
	if errors.Is(err, sql.ErrNoRows) {
		return link.Link{}, link.ErrNotFound
	}
	if err != nil {
		return link.Link{}, fmt.Errorf("link repo: find by id: %w", err)
	}
	return l, nil
}

func (r *LinkRepository) ListByTenant(ctx context.Context, tenantID int64, f link.ListFilter, p page.Params) ([]link.Link, int, error) {
	where, args := `l.tenant_id = ?`, []any{tenantID}
	if f.ChannelID != nil {
		where += ` AND l.channel_id = ?`
		args = append(args, *f.ChannelID)
	}
	if f.CampaignID != nil {
		where += ` AND ch.campaign_id = ?`
		args = append(args, *f.CampaignID)
	}
	var total int
	if err := r.db.QueryRowContext(ctx,
		`SELECT count(*) FROM links l LEFT JOIN channels ch ON ch.id = l.channel_id WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("link repo: count: %w", err)
	}
	rows, err := r.db.QueryContext(ctx,
		linkSelect+`WHERE `+where+` ORDER BY l.id DESC LIMIT ? OFFSET ?`,
		append(args, p.Limit, p.Offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("link repo: list: %w", err)
	}
	defer rows.Close()
	var out []link.Link
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("link repo: list: %w", err)
		}
		out = append(out, l)
	}
	return out, total, rows.Err()
}

// Delete only matches the tenant's own links, so another tenant's id looks like any unknown id.
func (r *LinkRepository) Delete(ctx context.Context, tenantID, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM links WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("link repo: delete: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("link repo: delete: %w", err)
	}
	if n == 0 {
		return link.ErrNotFound
	}
	return nil
}

// SetQRStyle only matches the tenant's own links, like Delete.
func (r *LinkRepository) SetQRStyle(ctx context.Context, tenantID, id int64, s link.QRStyle) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE links SET qr_foreground = ?, qr_background = ?, qr_logo_url = ? WHERE id = ? AND tenant_id = ?`,
		nullString(s.Foreground), nullString(s.Background), nullString(s.LogoURL), id, tenantID)
	if err != nil {
		return fmt.Errorf("link repo: set qr style: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("link repo: set qr style: %w", err)
	}
	if n == 0 {
		return link.ErrNotFound
	}
	return nil
}

// SetChannel only matches the tenant's own links, like Delete.
func (r *LinkRepository) SetChannel(ctx context.Context, tenantID, id int64, channelID *int64, originURL string, updatedBy int64, at time.Time) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE links SET channel_id = ?, origin_url = ?, updated_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
		nullInt64(channelID), originURL, updatedBy, formatTime(at), id, tenantID)
	if err != nil {
		return fmt.Errorf("link repo: set channel: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("link repo: set channel: %w", err)
	}
	if n == 0 {
		return link.ErrNotFound
	}
	return nil
}

// ConsumeClick increments click_count only while the link is under its limit. One statement
// keeps the check and the increment atomic, so concurrent clicks never exceed max_clicks.
func (r *LinkRepository) ConsumeClick(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE links SET click_count = click_count + 1
		 WHERE id = ? AND (max_clicks IS NULL OR click_count < max_clicks)`, id)
	if err != nil {
		return fmt.Errorf("link repo: consume click: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("link repo: consume click: %w", err)
	}
	if n == 0 {
		return link.ErrExpired
	}
	return nil
}

// domainKey is how a nil domain (the default host) matches the COALESCE in the unique index.
func domainKey(id *int64) int64 {
	if id == nil {
		return 0
	}
	return *id
}
