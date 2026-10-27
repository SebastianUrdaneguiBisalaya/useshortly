package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/unlockpage"
)

type UnlockPageRepository struct {
	db *sql.DB
}

func NewUnlockPageRepository(db *sql.DB) *UnlockPageRepository {
	return &UnlockPageRepository{db: db}
}

// scope is link_id as the database stores it: NULL for the organization's page.
func scope(linkID *int64) any {
	if linkID == nil {
		return nil
	}
	return *linkID
}

func (r *UnlockPageRepository) Upsert(ctx context.Context, p unlockpage.Page) (unlockpage.Page, error) {
	if p.LinkID != nil {
		var one int
		err := r.db.QueryRowContext(ctx, `SELECT 1 FROM links WHERE id = ? AND tenant_id = ?`, *p.LinkID, p.TenantID).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			return unlockpage.Page{}, unlockpage.ErrNotFound
		}
		if err != nil {
			return unlockpage.Page{}, fmt.Errorf("unlock page repo: link: %w", err)
		}
	}
	// The unique index is on COALESCE(link_id, 0), which ON CONFLICT cannot name, so replace by
	// updating first and inserting only when nothing matched.
	res, err := r.db.ExecContext(ctx,
		`UPDATE unlock_pages SET html = ?, updated_at = ? WHERE tenant_id = ? AND COALESCE(link_id, 0) = COALESCE(?, 0)`,
		p.HTML, formatTime(p.UpdatedAt), p.TenantID, scope(p.LinkID))
	if err != nil {
		return unlockpage.Page{}, fmt.Errorf("unlock page repo: update: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if _, err := r.db.ExecContext(ctx,
			`INSERT INTO unlock_pages (tenant_id, link_id, html, updated_at) VALUES (?, ?, ?, ?)`,
			p.TenantID, scope(p.LinkID), p.HTML, formatTime(p.UpdatedAt)); err != nil {
			return unlockpage.Page{}, fmt.Errorf("unlock page repo: insert: %w", err)
		}
	}
	return r.Get(ctx, p.TenantID, p.LinkID)
}

func (r *UnlockPageRepository) Get(ctx context.Context, tenantID int64, linkID *int64) (unlockpage.Page, error) {
	return r.scan(r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, link_id, html, updated_at FROM unlock_pages
		 WHERE tenant_id = ? AND COALESCE(link_id, 0) = COALESCE(?, 0)`, tenantID, scope(linkID)))
}

func (r *UnlockPageRepository) Delete(ctx context.Context, tenantID int64, linkID *int64) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM unlock_pages WHERE tenant_id = ? AND COALESCE(link_id, 0) = COALESCE(?, 0)`, tenantID, scope(linkID))
	if err != nil {
		return fmt.Errorf("unlock page repo: delete: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return unlockpage.ErrNotFound
	}
	return nil
}

// Find prefers the link's own page: ORDER BY puts a non-NULL link_id first.
func (r *UnlockPageRepository) Find(ctx context.Context, tenantID, linkID int64) (unlockpage.Page, error) {
	return r.scan(r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, link_id, html, updated_at FROM unlock_pages
		 WHERE tenant_id = ? AND (link_id = ? OR link_id IS NULL)
		 ORDER BY link_id IS NULL LIMIT 1`, tenantID, linkID))
}

func (r *UnlockPageRepository) scan(row *sql.Row) (unlockpage.Page, error) {
	var (
		p       unlockpage.Page
		linkID  sql.NullInt64
		updated string
	)
	err := row.Scan(&p.ID, &p.TenantID, &linkID, &p.HTML, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return unlockpage.Page{}, unlockpage.ErrNotFound
	}
	if err != nil {
		return unlockpage.Page{}, fmt.Errorf("unlock page repo: scan: %w", err)
	}
	if linkID.Valid {
		p.LinkID = &linkID.Int64
	}
	if p.UpdatedAt, err = parseTime(updated); err != nil {
		return unlockpage.Page{}, fmt.Errorf("unlock page repo: updated_at: %w", err)
	}
	return p, nil
}
