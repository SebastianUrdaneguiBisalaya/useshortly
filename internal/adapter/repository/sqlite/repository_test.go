package sqlite

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/database"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newDB opens a temporary database with every migration applied.
func newDB(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	s, err := database.NewSQLite(ctx, database.SQLiteConfig{Path: filepath.Join(t.TempDir(), "test.db")})
	if err != nil {
		t.Skipf("sqlite driver unavailable: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	files, _ := filepath.Glob("../../../../migrations/*.up.sql")
	sort.Strings(files)
	require.NotEmpty(t, files, "no migrations found")
	for _, f := range files {
		b, err := os.ReadFile(f)
		require.NoError(t, err)
		_, err = s.DB.ExecContext(ctx, string(b))
		require.NoErrorf(t, err, "apply %s", f)
	}
	return s.DB
}

func newUser(t *testing.T, repo *UserRepository, email string) user.User {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Millisecond)
	u, err := repo.Create(context.Background(),
		user.User{Email: email, FirstName: "Ana", LastName: "Lopez", CreatedAt: now},
		user.Account{AccountID: email, Provider: user.ProviderDefault, PasswordHash: "h", CreatedAt: now})
	require.NoError(t, err)
	return u
}

func TestUserRepository(t *testing.T) {
	ctx := context.Background()
	repo := NewUserRepository(newDB(t))
	u := newUser(t, repo, "ana@example.com")
	assert.NotZero(t, u.ID)

	got, err := repo.FindByEmail(ctx, "ANA@example.com")
	require.NoError(t, err)
	assert.Equal(t, u.ID, got.ID)
	assert.True(t, got.CreatedAt.Equal(u.CreatedAt))

	got, err = repo.FindByID(ctx, u.ID)
	require.NoError(t, err)
	assert.Equal(t, "ana@example.com", got.Email)

	acc, err := repo.FindAccount(ctx, u.ID, user.ProviderDefault)
	require.NoError(t, err)
	assert.Equal(t, "h", acc.PasswordHash)
	assert.Equal(t, user.ProviderDefault, acc.Provider)

	_, err = repo.FindAccount(ctx, u.ID, user.ProviderGoogle)
	assert.ErrorIs(t, err, user.ErrNotFound)
	_, err = repo.FindByEmail(ctx, "x@example.com")
	assert.ErrorIs(t, err, user.ErrNotFound)
	_, err = repo.FindByID(ctx, 999)
	assert.ErrorIs(t, err, user.ErrNotFound)
}

func TestUserRepositoryDuplicateEmailLeavesNothingBehind(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewUserRepository(db)
	newUser(t, repo, "ana@example.com")

	now := time.Now().UTC()
	_, err := repo.Create(ctx,
		user.User{Email: "Ana@Example.com", FirstName: "A", LastName: "B", CreatedAt: now},
		user.Account{AccountID: "x", Provider: user.ProviderDefault, CreatedAt: now})
	assert.ErrorIs(t, err, user.ErrEmailTaken)

	var users, accounts int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&users))
	require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM accounts`).Scan(&accounts))
	assert.Equal(t, 1, users)
	assert.Equal(t, 1, accounts)
}

func TestAPIKeyRepository(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewAPIKeyRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('other')`)
	require.NoError(t, err)

	now := time.Now().UTC().Truncate(time.Millisecond)
	exp := now.Add(time.Hour)
	k, err := repo.Create(ctx, apikey.APIKey{
		TenantID: 1, CreatedBy: u.ID, Name: "ci", Prefix: "usl_abcd1234", KeyHash: "h1", ExpiresAt: &exp, CreatedAt: now,
	})
	require.NoError(t, err)
	assert.NotZero(t, k.ID)

	got, err := repo.FindByHash(ctx, "h1")
	require.NoError(t, err)
	assert.Equal(t, "ci", got.Name)
	require.NotNil(t, got.ExpiresAt)
	assert.True(t, got.ExpiresAt.Equal(exp))
	assert.Nil(t, got.LastUsedAt)

	require.NoError(t, repo.TouchLastUsed(ctx, k.ID, now))
	got, err = repo.FindByHash(ctx, "h1")
	require.NoError(t, err)
	require.NotNil(t, got.LastUsedAt)
	assert.True(t, got.LastUsedAt.Equal(now))

	_, err = repo.FindByHash(ctx, "nope")
	assert.ErrorIs(t, err, apikey.ErrNotFound)

	list, err := repo.ListByTenant(ctx, 1)
	require.NoError(t, err)
	assert.Len(t, list, 1)
	list, err = repo.ListByTenant(ctx, 2)
	require.NoError(t, err)
	assert.Empty(t, list)

	assert.ErrorIs(t, repo.Delete(ctx, 2, k.ID), apikey.ErrNotFound)
	require.NoError(t, repo.Delete(ctx, 1, k.ID))
	_, err = repo.FindByHash(ctx, "h1")
	assert.ErrorIs(t, err, apikey.ErrNotFound)
}

func TestForeignKeysAreEnforced(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	_, err := NewAPIKeyRepository(db).Create(ctx, apikey.APIKey{
		TenantID: 99, CreatedBy: 99, Name: "x", Prefix: "p", KeyHash: "h", CreatedAt: time.Now(),
	})
	assert.Error(t, err)

	// Deleting a user cascades to its accounts.
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err = db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, u.ID)
	require.NoError(t, err)
	var n int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM accounts`).Scan(&n))
	assert.Zero(t, n)
}
