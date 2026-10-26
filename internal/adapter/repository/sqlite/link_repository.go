package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
)

type LinkRepository struct {
	db *sql.DB
}

func NewLinkRepository(db *sql.DB) *LinkRepository {
	return &LinkRepository{db: db}
}

func (r *LinkRepository) Create(ctx context.Context, l link.Link) (link.Link, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO links (code, origin_url, expires_at, max_clicks, tenant_id, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		l.Code, l.OriginURL, nullTime(l.ExpiresAt), nullInt64(l.MaxClicks), l.TenantID, l.CreatedBy, formatTime(l.CreatedAt))
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

func (r *LinkRepository) FindByCode(ctx context.Context, code string) (link.Link, error) {
	var (
		l                link.Link
		expires, updated sql.NullString
		updatedBy        sql.NullInt64
		maxClicks        sql.NullInt64
		createdAt        string
	)
	err := r.db.QueryRowContext(ctx,
		`SELECT id, code, origin_url, expires_at, max_clicks, click_count, tenant_id, created_by, updated_by, created_at, updated_at
		 FROM links WHERE code = ?`, code).
		Scan(&l.ID, &l.Code, &l.OriginURL, &expires, &maxClicks, &l.ClickCount, &l.TenantID, &l.CreatedBy, &updatedBy, &createdAt, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return link.Link{}, link.ErrNotFound
	}
	if err != nil {
		return link.Link{}, fmt.Errorf("link repo: find: %w", err)
	}
	if maxClicks.Valid {
		l.MaxClicks = &maxClicks.Int64
	}
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
