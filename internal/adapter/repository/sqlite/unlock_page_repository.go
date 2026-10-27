package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
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
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return unlockpage.Page{}, fmt.Errorf("unlock page repo: begin: %w", err)
	}
	defer tx.Rollback()

	if p.LinkID != nil {
		var one int
		err := tx.QueryRowContext(ctx, `SELECT 1 FROM links WHERE id = ? AND tenant_id = ?`, *p.LinkID, p.TenantID).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			return unlockpage.Page{}, unlockpage.ErrNotFound
		}
		if err != nil {
			return unlockpage.Page{}, fmt.Errorf("unlock page repo: link: %w", err)
		}
	}
	// The unique index is on COALESCE(link_id, 0), which ON CONFLICT cannot name, so replace by
	// updating first and inserting only when nothing matched.
	res, err := tx.ExecContext(ctx,
		`UPDATE unlock_pages SET html = ?, updated_by = ?, updated_at = ? WHERE tenant_id = ? AND COALESCE(link_id, 0) = COALESCE(?, 0)`,
		p.HTML, p.UpdatedBy, formatTime(p.UpdatedAt), p.TenantID, scope(p.LinkID))
	if err != nil {
		return unlockpage.Page{}, fmt.Errorf("unlock page repo: update: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO unlock_pages (tenant_id, link_id, html, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`,
			p.TenantID, scope(p.LinkID), p.HTML, p.UpdatedBy, formatTime(p.UpdatedAt)); err != nil {
			return unlockpage.Page{}, fmt.Errorf("unlock page repo: insert: %w", err)
		}
	}
	if err := recordEvent(ctx, tx, p.TenantID, p.LinkID, p.UpdatedBy, unlockpage.ActionSet, p.UpdatedAt); err != nil {
		return unlockpage.Page{}, err
	}
	if err := tx.Commit(); err != nil {
		return unlockpage.Page{}, fmt.Errorf("unlock page repo: commit: %w", err)
	}
	return r.Get(ctx, p.TenantID, p.LinkID)
}

func recordEvent(ctx context.Context, tx *sql.Tx, tenantID int64, linkID *int64, userID int64, action unlockpage.Action, at time.Time) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO unlock_page_events (tenant_id, link_id, user_id, action, created_at) VALUES (?, ?, ?, ?, ?)`,
		tenantID, scope(linkID), userID, string(action), formatTime(at)); err != nil {
		return fmt.Errorf("unlock page repo: event: %w", err)
	}
	return nil
}

func (r *UnlockPageRepository) Get(ctx context.Context, tenantID int64, linkID *int64) (unlockpage.Page, error) {
	return r.scan(r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, link_id, html, updated_by, updated_at FROM unlock_pages
		 WHERE tenant_id = ? AND COALESCE(link_id, 0) = COALESCE(?, 0)`, tenantID, scope(linkID)))
}

func (r *UnlockPageRepository) Delete(ctx context.Context, tenantID, userID int64, linkID *int64, at time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("unlock page repo: begin: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`DELETE FROM unlock_pages WHERE tenant_id = ? AND COALESCE(link_id, 0) = COALESCE(?, 0)`, tenantID, scope(linkID))
	if err != nil {
		return fmt.Errorf("unlock page repo: delete: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return unlockpage.ErrNotFound
	}
	if err := recordEvent(ctx, tx, tenantID, linkID, userID, unlockpage.ActionDelete, at); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("unlock page repo: commit: %w", err)
	}
	return nil
}

func (r *UnlockPageRepository) History(ctx context.Context, tenantID int64, p page.Params) ([]unlockpage.Event, int, error) {
	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM unlock_page_events WHERE tenant_id = ?`, tenantID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("unlock page repo: count: %w", err)
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, tenant_id, link_id, user_id, action, created_at FROM unlock_page_events
		 WHERE tenant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`, tenantID, p.Limit, p.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("unlock page repo: history: %w", err)
	}
	defer rows.Close()
	var out []unlockpage.Event
	for rows.Next() {
		var (
			e      unlockpage.Event
			linkID sql.NullInt64
			action string
			at     string
		)
		if err := rows.Scan(&e.ID, &e.TenantID, &linkID, &e.UserID, &action, &at); err != nil {
			return nil, 0, fmt.Errorf("unlock page repo: history: %w", err)
		}
		if linkID.Valid {
			e.LinkID = &linkID.Int64
		}
		e.Action = unlockpage.Action(action)
		if e.At, err = parseTime(at); err != nil {
			return nil, 0, fmt.Errorf("unlock page repo: history: %w", err)
		}
		out = append(out, e)
	}
	return out, total, rows.Err()
}

// Find prefers the link's own page: ORDER BY puts a non-NULL link_id first.
func (r *UnlockPageRepository) Find(ctx context.Context, tenantID, linkID int64) (unlockpage.Page, error) {
	return r.scan(r.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, link_id, html, updated_by, updated_at FROM unlock_pages
		 WHERE tenant_id = ? AND (link_id = ? OR link_id IS NULL)
		 ORDER BY link_id IS NULL LIMIT 1`, tenantID, linkID))
}

func (r *UnlockPageRepository) scan(row *sql.Row) (unlockpage.Page, error) {
	var (
		p       unlockpage.Page
		linkID  sql.NullInt64
		updated string
	)
	err := row.Scan(&p.ID, &p.TenantID, &linkID, &p.HTML, &p.UpdatedBy, &updated)
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
