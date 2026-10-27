package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// OrgPurgeRepository implements org.PurgeStore.
type OrgPurgeRepository struct {
	db *sql.DB
}

func NewOrgPurgeRepository(db *sql.DB) *OrgPurgeRepository {
	return &OrgPurgeRepository{db: db}
}

func (r *OrgPurgeRepository) PendingDeletion(ctx context.Context, limit int) ([]int64, error) {
	return r.ids(ctx, `SELECT id FROM organizations WHERE deleted_at IS NOT NULL ORDER BY id LIMIT ?`, limit)
}

func (r *OrgPurgeRepository) LinkIDs(ctx context.Context, tenantID int64, limit int) ([]int64, error) {
	return r.ids(ctx, `SELECT id FROM links WHERE tenant_id = ? ORDER BY id LIMIT ?`, tenantID, limit)
}

func (r *OrgPurgeRepository) ids(ctx context.Context, query string, args ...any) ([]int64, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("purge repo: %w", err)
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("purge repo: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *OrgPurgeRepository) DeleteLinks(ctx context.Context, tenantID int64, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	args := make([]any, 0, len(ids)+1)
	args = append(args, tenantID)
	for _, id := range ids {
		args = append(args, id)
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	if _, err := r.db.ExecContext(ctx, `DELETE FROM links WHERE tenant_id = ? AND id IN (`+marks+`)`, args...); err != nil {
		return fmt.Errorf("purge repo: delete links: %w", err)
	}
	return nil
}

// DeleteOrganization only touches organizations that were soft deleted, so it can never remove a live one.
func (r *OrgPurgeRepository) DeleteOrganization(ctx context.Context, tenantID int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM organizations WHERE id = ? AND deleted_at IS NOT NULL`, tenantID); err != nil {
		return fmt.Errorf("purge repo: delete organization: %w", err)
	}
	return nil
}
