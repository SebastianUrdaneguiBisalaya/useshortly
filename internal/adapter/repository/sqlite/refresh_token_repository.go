package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
)

type RefreshTokenRepository struct {
	db *sql.DB
}

func NewRefreshTokenRepository(db *sql.DB) *RefreshTokenRepository {
	return &RefreshTokenRepository{db: db}
}

const nowSQL = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

func (r *RefreshTokenRepository) Create(ctx context.Context, t auth.RefreshToken) (auth.RefreshToken, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		t.UserID, t.TenantID, t.TokenHash, formatTime(t.ExpiresAt), formatTime(t.CreatedAt))
	if err != nil {
		return auth.RefreshToken{}, fmt.Errorf("refresh repo: insert: %w", err)
	}
	if t.ID, err = res.LastInsertId(); err != nil {
		return auth.RefreshToken{}, fmt.Errorf("refresh repo: id: %w", err)
	}
	return t, nil
}

func (r *RefreshTokenRepository) FindByHash(ctx context.Context, hash string) (auth.RefreshToken, error) {
	var (
		t                    auth.RefreshToken
		expiresAt, createdAt string
		revokedAt            sql.NullString
	)
	err := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, tenant_id, token_hash, expires_at, revoked_at, created_at
		 FROM refresh_tokens WHERE token_hash = ?`, hash).
		Scan(&t.ID, &t.UserID, &t.TenantID, &t.TokenHash, &expiresAt, &revokedAt, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.RefreshToken{}, auth.ErrRefreshTokenNotFound
	}
	if err != nil {
		return auth.RefreshToken{}, fmt.Errorf("refresh repo: find: %w", err)
	}
	if t.ExpiresAt, err = parseTime(expiresAt); err != nil {
		return auth.RefreshToken{}, fmt.Errorf("refresh repo: expires_at: %w", err)
	}
	if t.RevokedAt, err = parseNullTime(revokedAt); err != nil {
		return auth.RefreshToken{}, fmt.Errorf("refresh repo: revoked_at: %w", err)
	}
	if t.CreatedAt, err = parseTime(createdAt); err != nil {
		return auth.RefreshToken{}, fmt.Errorf("refresh repo: created_at: %w", err)
	}
	return t, nil
}

// Revoke is idempotent: revoking an already revoked token keeps its first revocation time.
func (r *RefreshTokenRepository) Revoke(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, `+nowSQL+`) WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("refresh repo: revoke: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("refresh repo: revoke: %w", err)
	}
	if n == 0 {
		return auth.ErrRefreshTokenNotFound
	}
	return nil
}

func (r *RefreshTokenRepository) RevokeForMember(ctx context.Context, userID, tenantID int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = `+nowSQL+`
		 WHERE user_id = ? AND tenant_id = ? AND revoked_at IS NULL`, userID, tenantID)
	if err != nil {
		return fmt.Errorf("refresh repo: revoke for member: %w", err)
	}
	return nil
}

func (r *RefreshTokenRepository) RevokeForUser(ctx context.Context, userID int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = `+nowSQL+` WHERE user_id = ? AND revoked_at IS NULL`, userID)
	if err != nil {
		return fmt.Errorf("refresh repo: revoke for user: %w", err)
	}
	return nil
}
