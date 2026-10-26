package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type APIKeyRepository struct {
	db *sql.DB
}

func NewAPIKeyRepository(db *sql.DB) *APIKeyRepository {
	return &APIKeyRepository{db: db}
}

const apiKeyColumns = `id, tenant_id, created_by, name, prefix, key_hash, scope, last_used_at, expires_at, created_at`

func (r *APIKeyRepository) Create(ctx context.Context, k apikey.APIKey) (apikey.APIKey, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO api_keys (tenant_id, created_by, name, prefix, key_hash, scope, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		k.TenantID, k.CreatedBy, k.Name, k.Prefix, k.KeyHash, string(k.Scope), nullTime(k.ExpiresAt), formatTime(k.CreatedAt))
	if err != nil {
		return apikey.APIKey{}, fmt.Errorf("apikey repo: insert: %w", err)
	}
	if k.ID, err = res.LastInsertId(); err != nil {
		return apikey.APIKey{}, fmt.Errorf("apikey repo: id: %w", err)
	}
	return k, nil
}

func (r *APIKeyRepository) ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]apikey.APIKey, int, error) {
	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM api_keys WHERE tenant_id = ?`, tenantID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("apikey repo: count: %w", err)
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+apiKeyColumns+` FROM api_keys WHERE tenant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
		tenantID, p.Limit, p.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("apikey repo: list: %w", err)
	}
	defer rows.Close()
	var out []apikey.APIKey
	for rows.Next() {
		k, err := scanAPIKey(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, k)
	}
	return out, total, rows.Err()
}

func (r *APIKeyRepository) Delete(ctx context.Context, tenantID, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM api_keys WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("apikey repo: delete: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("apikey repo: delete: %w", err)
	}
	if n == 0 {
		return apikey.ErrNotFound
	}
	return nil
}

func (r *APIKeyRepository) FindByHash(ctx context.Context, hash string) (apikey.APIKey, error) {
	k, err := scanAPIKey(r.db.QueryRowContext(ctx,
		`SELECT `+apiKeyColumns+` FROM api_keys WHERE key_hash = ?`, hash))
	if errors.Is(err, sql.ErrNoRows) {
		return apikey.APIKey{}, apikey.ErrNotFound
	}
	return k, err
}

func (r *APIKeyRepository) TouchLastUsed(ctx context.Context, id int64, at time.Time) error {
	if _, err := r.db.ExecContext(ctx, `UPDATE api_keys SET last_used_at = ? WHERE id = ?`, formatTime(at), id); err != nil {
		return fmt.Errorf("apikey repo: touch: %w", err)
	}
	return nil
}

type scanner interface{ Scan(dest ...any) error }

func scanAPIKey(s scanner) (apikey.APIKey, error) {
	var (
		k                 apikey.APIKey
		lastUsed, expires sql.NullString
		createdAt         string
	)
	var scope string
	err := s.Scan(&k.ID, &k.TenantID, &k.CreatedBy, &k.Name, &k.Prefix, &k.KeyHash, &scope, &lastUsed, &expires, &createdAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return apikey.APIKey{}, err
		}
		return apikey.APIKey{}, fmt.Errorf("apikey repo: scan: %w", err)
	}
	k.Scope = apikey.Scope(scope)
	if k.LastUsedAt, err = parseNullTime(lastUsed); err != nil {
		return apikey.APIKey{}, fmt.Errorf("apikey repo: last_used_at: %w", err)
	}
	if k.ExpiresAt, err = parseNullTime(expires); err != nil {
		return apikey.APIKey{}, fmt.Errorf("apikey repo: expires_at: %w", err)
	}
	if k.CreatedAt, err = parseTime(createdAt); err != nil {
		return apikey.APIKey{}, fmt.Errorf("apikey repo: created_at: %w", err)
	}
	return k, nil
}
