package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

type UserRepository struct {
	db *sql.DB
}

func NewUserRepository(db *sql.DB) *UserRepository {
	return &UserRepository{db: db}
}

const userColumns = `id, email, email_verified, first_name, last_name, image_url, created_at, updated_at`

func (r *UserRepository) Create(ctx context.Context, u user.User, a user.Account) (user.User, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return user.User{}, fmt.Errorf("user repo: begin: %w", err)
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`INSERT INTO users (email, email_verified, first_name, last_name, image_url, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		u.Email, u.EmailVerified, u.FirstName, u.LastName, nullString(u.ImageURL), formatTime(u.CreatedAt))
	if isUniqueViolation(err) {
		return user.User{}, user.ErrEmailTaken
	}
	if err != nil {
		return user.User{}, fmt.Errorf("user repo: insert user: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return user.User{}, fmt.Errorf("user repo: user id: %w", err)
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO accounts (user_id, account_id, provider_id, password, scope, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, a.AccountID, string(a.Provider), nullString(a.PasswordHash), nullString(a.Scope), formatTime(a.CreatedAt))
	if err != nil {
		return user.User{}, fmt.Errorf("user repo: insert account: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return user.User{}, fmt.Errorf("user repo: commit: %w", err)
	}
	u.ID = id
	return u, nil
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (user.User, error) {
	return r.findOne(ctx, `SELECT `+userColumns+` FROM users WHERE lower(email) = lower(?)`, email)
}

func (r *UserRepository) FindByID(ctx context.Context, id int64) (user.User, error) {
	return r.findOne(ctx, `SELECT `+userColumns+` FROM users WHERE id = ?`, id)
}

func (r *UserRepository) findOne(ctx context.Context, query string, arg any) (user.User, error) {
	var (
		u         user.User
		image     sql.NullString
		createdAt string
		updatedAt sql.NullString
		verified  int
	)
	err := r.db.QueryRowContext(ctx, query, arg).
		Scan(&u.ID, &u.Email, &verified, &u.FirstName, &u.LastName, &image, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return user.User{}, user.ErrNotFound
	}
	if err != nil {
		return user.User{}, fmt.Errorf("user repo: find: %w", err)
	}
	u.EmailVerified = verified == 1
	u.ImageURL = image.String
	if u.CreatedAt, err = parseTime(createdAt); err != nil {
		return user.User{}, fmt.Errorf("user repo: created_at: %w", err)
	}
	if u.UpdatedAt, err = parseNullTime(updatedAt); err != nil {
		return user.User{}, fmt.Errorf("user repo: updated_at: %w", err)
	}
	return u, nil
}

const accountColumns = `id, user_id, account_id, provider_id, password, scope, created_at, updated_at`

func (r *UserRepository) FindAccount(ctx context.Context, userID int64, provider user.Provider) (user.Account, error) {
	return r.findAccount(ctx, `SELECT `+accountColumns+` FROM accounts WHERE user_id = ? AND provider_id = ?`, userID, string(provider))
}

func (r *UserRepository) FindAccountByProvider(ctx context.Context, provider user.Provider, accountID string) (user.Account, error) {
	return r.findAccount(ctx, `SELECT `+accountColumns+` FROM accounts WHERE provider_id = ? AND account_id = ?`, string(provider), accountID)
}

func (r *UserRepository) findAccount(ctx context.Context, query string, args ...any) (user.Account, error) {
	var (
		a         user.Account
		password  sql.NullString
		scope     sql.NullString
		providerS string
		createdAt string
		updatedAt sql.NullString
	)
	err := r.db.QueryRowContext(ctx, query, args...).
		Scan(&a.ID, &a.UserID, &a.AccountID, &providerS, &password, &scope, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return user.Account{}, user.ErrNotFound
	}
	if err != nil {
		return user.Account{}, fmt.Errorf("user repo: find account: %w", err)
	}
	a.Provider = user.Provider(providerS)
	a.PasswordHash, a.Scope = password.String, scope.String
	if a.CreatedAt, err = parseTime(createdAt); err != nil {
		return user.Account{}, fmt.Errorf("user repo: account created_at: %w", err)
	}
	if a.UpdatedAt, err = parseNullTime(updatedAt); err != nil {
		return user.Account{}, fmt.Errorf("user repo: account updated_at: %w", err)
	}
	return a, nil
}

func (r *UserRepository) UpdatePassword(ctx context.Context, userID int64, hash string, at time.Time) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE accounts SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?`,
		hash, formatTime(at), userID, string(user.ProviderDefault))
	if err != nil {
		return fmt.Errorf("user repo: update password: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("user repo: update password: %w", err)
	}
	if n == 0 {
		return user.ErrNotFound
	}
	return nil
}

func (r *UserRepository) UpdateAccountScope(ctx context.Context, accountID int64, scope string, at time.Time) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE accounts SET scope = ?, updated_at = ? WHERE id = ?`, nullString(scope), formatTime(at), accountID)
	if err != nil {
		return fmt.Errorf("user repo: update scope: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("user repo: update scope: %w", err)
	}
	if n == 0 {
		return user.ErrNotFound
	}
	return nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
