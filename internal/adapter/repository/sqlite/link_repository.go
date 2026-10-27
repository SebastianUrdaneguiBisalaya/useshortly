package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

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
		`INSERT INTO links (code, origin_url, expires_at, max_clicks, password_hash, tenant_id, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		l.Code, l.OriginURL, nullTime(l.ExpiresAt), nullInt64(l.MaxClicks), nullString(l.PasswordHash), l.TenantID, l.CreatedBy, formatTime(l.CreatedAt))
	if isUniqueViolation(err) {
		return link.Link{}, link.ErrCodeTaken
	}
	if err != nil {
		return link.Link{}, fmt.Errorf("link repo: insert: %w", err)
	}
	if l.ID, err = res.LastInsertId(); err != nil {
		return link.Link{}, fmt.Errorf("link repo: id: %w", err)
	}
	return l, nil
}

const linkColumns = `id, code, origin_url, expires_at, max_clicks, click_count, password_hash, tenant_id, created_by, updated_by, created_at, updated_at`

// scanLink reads a row selected with linkColumns from a *sql.Row or *sql.Rows.
func scanLink(row interface{ Scan(...any) error }) (link.Link, error) {
	var (
		l                link.Link
		expires, updated sql.NullString
		passwordHash     sql.NullString
		updatedBy        sql.NullInt64
		maxClicks        sql.NullInt64
		createdAt        string
	)
	err := row.Scan(&l.ID, &l.Code, &l.OriginURL, &expires, &maxClicks, &l.ClickCount, &passwordHash, &l.TenantID, &l.CreatedBy, &updatedBy, &createdAt, &updated)
	if err != nil {
		return link.Link{}, err
	}
	if maxClicks.Valid {
		l.MaxClicks = &maxClicks.Int64
	}
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

func (r *LinkRepository) FindByCode(ctx context.Context, code string) (link.Link, error) {
	l, err := scanLink(r.db.QueryRowContext(ctx, `SELECT `+linkColumns+` FROM links WHERE code = ?`, code))
	if errors.Is(err, sql.ErrNoRows) {
		return link.Link{}, link.ErrNotFound
	}
	if err != nil {
		return link.Link{}, fmt.Errorf("link repo: find: %w", err)
	}
	return l, nil
}

func (r *LinkRepository) FindByID(ctx context.Context, tenantID, id int64) (link.Link, error) {
	l, err := scanLink(r.db.QueryRowContext(ctx, `SELECT `+linkColumns+` FROM links WHERE id = ? AND tenant_id = ?`, id, tenantID))
	if errors.Is(err, sql.ErrNoRows) {
		return link.Link{}, link.ErrNotFound
	}
	if err != nil {
		return link.Link{}, fmt.Errorf("link repo: find by id: %w", err)
	}
	return l, nil
}

func (r *LinkRepository) ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]link.Link, int, error) {
	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM links WHERE tenant_id = ?`, tenantID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("link repo: count: %w", err)
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+linkColumns+` FROM links WHERE tenant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
		tenantID, p.Limit, p.Offset)
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

// ConsumeClick increments click_count only while the link is under its limit. One statement
// keeps the check and the increment atomic, so concurrent clicks never exceed max_clicks.
func (r *LinkRepository) ConsumeClick(ctx context.Context, code string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE links SET click_count = click_count + 1
		 WHERE code = ? AND (max_clicks IS NULL OR click_count < max_clicks)`, code)
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
