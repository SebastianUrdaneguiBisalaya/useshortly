package sqlite

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
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
		TenantID: 1, CreatedBy: u.ID, Name: "ci", Prefix: "usl_abcd1234", KeyHash: "h1", Scope: apikey.ScopeRead, ExpiresAt: &exp, CreatedAt: now,
	})
	require.NoError(t, err)
	assert.NotZero(t, k.ID)

	got, err := repo.FindByHash(ctx, "h1")
	require.NoError(t, err)
	assert.Equal(t, "ci", got.Name)
	assert.Equal(t, apikey.ScopeRead, got.Scope)
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

	list, total, err := repo.ListByTenant(ctx, 1, page.Params{}.Normalize())
	require.NoError(t, err)
	assert.Len(t, list, 1)
	assert.Equal(t, 1, total)
	list, total, err = repo.ListByTenant(ctx, 2, page.Params{}.Normalize())
	require.NoError(t, err)
	assert.Empty(t, list)
	assert.Zero(t, total)

	assert.ErrorIs(t, repo.Delete(ctx, 2, k.ID), apikey.ErrNotFound)
	require.NoError(t, repo.Delete(ctx, 1, k.ID))
	_, err = repo.FindByHash(ctx, "h1")
	assert.ErrorIs(t, err, apikey.ErrNotFound)
}

func TestForeignKeysAreEnforced(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	_, err := NewAPIKeyRepository(db).Create(ctx, apikey.APIKey{
		TenantID: 99, CreatedBy: 99, Name: "x", Prefix: "p", KeyHash: "h", Scope: apikey.ScopeRead, CreatedAt: time.Now(),
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

func TestLinkRepository(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewLinkRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme')`)
	require.NoError(t, err)

	now := time.Now().UTC().Truncate(time.Millisecond)
	exp := now.Add(time.Hour)
	created, err := repo.Create(ctx, link.Link{
		Code: "abc1234", OriginURL: "https://example.com/a", ExpiresAt: &exp, TenantID: 1, CreatedBy: u.ID, CreatedAt: now,
	})
	require.NoError(t, err)
	assert.NotZero(t, created.ID)

	got, err := repo.FindByCode(ctx, "abc1234")
	require.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)
	assert.Equal(t, "https://example.com/a", got.OriginURL)
	assert.EqualValues(t, 1, got.TenantID)
	assert.Equal(t, u.ID, got.CreatedBy)
	assert.Nil(t, got.UpdatedBy)
	assert.Nil(t, got.UpdatedAt)
	require.NotNil(t, got.ExpiresAt)
	assert.True(t, got.ExpiresAt.Equal(exp))
	assert.True(t, got.CreatedAt.Equal(now))

	_, err = repo.FindByCode(ctx, "nope000")
	assert.ErrorIs(t, err, link.ErrNotFound)

	_, err = repo.Create(ctx, link.Link{Code: "abc1234", OriginURL: "https://other.com", TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	assert.ErrorIs(t, err, link.ErrCodeTaken)
}

func TestLinkRepositoryMaxClicks(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewLinkRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)
	two := int64(2)
	_, err = repo.Create(ctx, link.Link{Code: "limit00", OriginURL: "https://example.com", MaxClicks: &two, TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)
	_, err = repo.Create(ctx, link.Link{Code: "free000", OriginURL: "https://example.com", TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)

	got, err := repo.FindByCode(ctx, "limit00")
	require.NoError(t, err)
	assert.Equal(t, &two, got.MaxClicks)
	assert.Zero(t, got.ClickCount)

	require.NoError(t, repo.ConsumeClick(ctx, "limit00"))
	require.NoError(t, repo.ConsumeClick(ctx, "limit00"))
	assert.ErrorIs(t, repo.ConsumeClick(ctx, "limit00"), link.ErrExpired)
	got, err = repo.FindByCode(ctx, "limit00")
	require.NoError(t, err)
	assert.EqualValues(t, 2, got.ClickCount)

	free, err := repo.FindByCode(ctx, "free000")
	require.NoError(t, err)
	assert.Nil(t, free.MaxClicks)

	_, err = db.ExecContext(ctx, `UPDATE links SET max_clicks = 0 WHERE code = 'free000'`)
	assert.Error(t, err, "the database rejects max_clicks below 1")
}

func TestLinkRepositoryListAndDelete(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewLinkRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	for _, name := range []string{"acme", "other"} {
		_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES (?)`, name)
		require.NoError(t, err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	two := int64(2)
	var ids []int64
	for i, code := range []string{"aaaaaaa", "bbbbbbb", "ccccccc"} {
		l := link.Link{Code: code, OriginURL: "https://example.com/" + code, TenantID: 1, CreatedBy: u.ID, CreatedAt: now}
		if i == 0 {
			l.MaxClicks = &two
		}
		created, err := repo.Create(ctx, l)
		require.NoError(t, err)
		ids = append(ids, created.ID)
	}
	_, err := repo.Create(ctx, link.Link{Code: "zzzzzzz", OriginURL: "https://example.com/z", TenantID: 2, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)

	list, total, err := repo.ListByTenant(ctx, 1, page.Params{Limit: 2})
	require.NoError(t, err)
	assert.Equal(t, 3, total, "total ignores the window and the other tenant")
	require.Len(t, list, 2)
	assert.Equal(t, "ccccccc", list[0].Code, "newest first")
	assert.Equal(t, "bbbbbbb", list[1].Code)

	list, _, err = repo.ListByTenant(ctx, 1, page.Params{Limit: 2, Offset: 2})
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "aaaaaaa", list[0].Code)
	assert.Equal(t, &two, list[0].MaxClicks, "list rows carry every column")

	list, total, err = repo.ListByTenant(ctx, 3, page.Params{Limit: 10})
	require.NoError(t, err)
	assert.Empty(t, list)
	assert.Zero(t, total)

	assert.ErrorIs(t, repo.Delete(ctx, 2, ids[0]), link.ErrNotFound, "another tenant's link is not found")
	_, err = repo.FindByCode(ctx, "aaaaaaa")
	require.NoError(t, err)
	require.NoError(t, repo.Delete(ctx, 1, ids[0]))
	_, err = repo.FindByCode(ctx, "aaaaaaa")
	assert.ErrorIs(t, err, link.ErrNotFound)
	assert.ErrorIs(t, repo.Delete(ctx, 1, ids[0]), link.ErrNotFound)
}

func TestClickRepository(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	links := NewLinkRepository(db)
	clicks := NewClickRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)
	l, err := links.Create(ctx, link.Link{Code: "abc1234", OriginURL: "https://example.com", TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)

	c, err := clicks.Create(ctx, analytics.Click{LinkID: l.ID, At: now, Referrer: "https://news.example", UserAgent: "Mozilla/5.0", Country: "PE", Device: "mobile"})
	require.NoError(t, err)
	assert.NotZero(t, c.ID)
	_, err = clicks.Create(ctx, analytics.Click{LinkID: l.ID, At: now})
	require.NoError(t, err, "referrer, user agent, country and device are optional")

	var referrer, ua, country, device, at string
	require.NoError(t, db.QueryRowContext(ctx,
		`SELECT referrer, user_agent, country, device, clicked_at FROM clicks WHERE id = ?`, c.ID).
		Scan(&referrer, &ua, &country, &device, &at))
	assert.Equal(t, []string{"https://news.example", "Mozilla/5.0", "PE", "mobile"}, []string{referrer, ua, country, device})
	assert.Equal(t, formatTime(now), at)

	_, err = clicks.Create(ctx, analytics.Click{LinkID: 9999, At: now})
	assert.Error(t, err, "a click needs an existing link")

	// Deleting a link takes its clicks with it.
	require.NoError(t, links.Delete(ctx, 1, l.ID))
	var n int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM clicks`).Scan(&n))
	assert.Zero(t, n)
}

func TestLinkRepositoryAllowsSameExpiry(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewLinkRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme')`)
	require.NoError(t, err)
	now := time.Now().UTC()
	exp := now.Add(time.Hour)
	for _, code := range []string{"aaaaaaa", "bbbbbbb"} {
		_, err := repo.Create(ctx, link.Link{Code: code, OriginURL: "https://example.com", ExpiresAt: &exp, TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
		require.NoError(t, err, code)
	}
}

func TestAPIKeyScopeIsConstrainedByTheDatabase(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewAPIKeyRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme')`)
	require.NoError(t, err)

	_, err = repo.Create(ctx, apikey.APIKey{TenantID: 1, CreatedBy: u.ID, Name: "x", Prefix: "p", KeyHash: "h1", Scope: "admin", CreatedAt: time.Now().UTC()})
	assert.Error(t, err, "the CHECK refuses a scope the domain would never create")
	_, err = repo.Create(ctx, apikey.APIKey{TenantID: 1, CreatedBy: u.ID, Name: "x", Prefix: "p", KeyHash: "h2", CreatedAt: time.Now().UTC()})
	assert.Error(t, err, "and an empty one")
}
