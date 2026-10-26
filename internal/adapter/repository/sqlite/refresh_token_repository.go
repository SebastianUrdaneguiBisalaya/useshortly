package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
)

type RefreshTokenRepository struct {
	db *sql.DB
}

func NewRefreshTokenRepository(db *sql.DB) *RefreshTokenRepository {
	return &RefreshTokenRepository{db: db}
}

func (r *RefreshTokenRepository) Create(ctx context.Context, t auth.RefreshToken) (auth.RefreshToken, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		t.UserID, t.TokenHash, formatTime(t.ExpiresAt), formatTime(t.CreatedAt))
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
		`SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
		 FROM refresh_tokens WHERE token_hash = ?`, hash).
		Scan(&t.ID, &t.UserID, &t.TokenHash, &expiresAt, &revokedAt, &createdAt)
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

// Revoke only touches a live token, so of two concurrent calls exactly one gets true.
func (r *RefreshTokenRepository) Revoke(ctx context.Context, id int64, at time.Time) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, formatTime(at), id)
	if err != nil {
		return false, fmt.Errorf("refresh repo: revoke: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("refresh repo: revoke: %w", err)
	}
	if n > 0 {
		return true, nil
	}
	var one int
	err = r.db.QueryRowContext(ctx, `SELECT 1 FROM refresh_tokens WHERE id = ?`, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, auth.ErrRefreshTokenNotFound
	}
	if err != nil {
		return false, fmt.Errorf("refresh repo: revoke: %w", err)
	}
	return false, nil // it was already revoked
}

func (r *RefreshTokenRepository) RevokeForUser(ctx context.Context, userID int64, at time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, formatTime(at), userID)
	if err != nil {
		return fmt.Errorf("refresh repo: revoke for user: %w", err)
	}
	return nil
}
