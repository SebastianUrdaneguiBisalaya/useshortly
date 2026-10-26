package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/database"
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
	files, _ := filepath.Glob("../../../../migrations/*_up.sql")
	sort.Strings(files)
	if len(files) == 0 {
		t.Fatal("no migrations found")
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.DB.ExecContext(ctx, string(b)); err != nil {
			t.Fatalf("apply %s: %v", f, err)
		}
	}
	return s.DB
}

func TestUserRepository(t *testing.T) {
	ctx := context.Background()
	repo := NewUserRepository(newDB(t))
	now := time.Now().UTC().Truncate(time.Millisecond)
	u, err := repo.Create(ctx,
		user.User{Email: "ana@example.com", FirstName: "Ana", LastName: "Lopez", CreatedAt: now},
		user.Account{AccountID: "ana@example.com", Provider: user.ProviderDefault, PasswordHash: "h", CreatedAt: now})
	if err != nil || u.ID == 0 {
		t.Fatalf("Create = %+v, %v", u, err)
	}
	got, err := repo.FindByEmail(ctx, "ANA@example.com")
	if err != nil || got.ID != u.ID || !got.CreatedAt.Equal(now) {
		t.Fatalf("FindByEmail = %+v, %v", got, err)
	}
	if got, err = repo.FindByID(ctx, u.ID); err != nil || got.Email != "ana@example.com" {
		t.Fatalf("FindByID = %+v, %v", got, err)
	}
	acc, err := repo.FindAccount(ctx, u.ID, user.ProviderDefault)
	if err != nil || acc.PasswordHash != "h" || acc.Provider != user.ProviderDefault {
		t.Fatalf("FindAccount = %+v, %v", acc, err)
	}
	if _, err := repo.FindAccount(ctx, u.ID, user.ProviderGoogle); !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("missing account err = %v", err)
	}
	if _, err := repo.FindByEmail(ctx, "x@example.com"); !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("missing user err = %v", err)
	}
	_, err = repo.Create(ctx,
		user.User{Email: "Ana@Example.com", FirstName: "A", LastName: "B", CreatedAt: now},
		user.Account{AccountID: "x", Provider: user.ProviderDefault, CreatedAt: now})
	if !errors.Is(err, user.ErrEmailTaken) {
		t.Fatalf("duplicate email err = %v, want ErrEmailTaken", err)
	}
}

func TestAPIKeyRepository(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	users := NewUserRepository(db)
	repo := NewAPIKeyRepository(db)
	now := time.Now().UTC().Truncate(time.Millisecond)
	u, err := users.Create(ctx,
		user.User{Email: "ana@example.com", FirstName: "Ana", LastName: "Lopez", CreatedAt: now},
		user.Account{AccountID: "a", Provider: user.ProviderDefault, CreatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('other')`); err != nil {
		t.Fatal(err)
	}
	exp := now.Add(time.Hour)
	k, err := repo.Create(ctx, apikey.APIKey{TenantID: 1, CreatedBy: u.ID, Name: "ci", Prefix: "usl_abcd1234", KeyHash: "h1", ExpiresAt: &exp, CreatedAt: now})
	if err != nil || k.ID == 0 {
		t.Fatalf("Create = %+v, %v", k, err)
	}
	got, err := repo.FindByHash(ctx, "h1")
	if err != nil || got.Name != "ci" || got.ExpiresAt == nil || !got.ExpiresAt.Equal(exp) || got.LastUsedAt != nil {
		t.Fatalf("FindByHash = %+v, %v", got, err)
	}
	if err := repo.TouchLastUsed(ctx, k.ID, now); err != nil {
		t.Fatal(err)
	}
	if got, _ = repo.FindByHash(ctx, "h1"); got.LastUsedAt == nil || !got.LastUsedAt.Equal(now) {
		t.Fatalf("LastUsedAt = %v", got.LastUsedAt)
	}
	if _, err := repo.FindByHash(ctx, "nope"); !errors.Is(err, apikey.ErrNotFound) {
		t.Fatalf("unknown hash err = %v", err)
	}
	if list, err := repo.ListByTenant(ctx, 1); err != nil || len(list) != 1 {
		t.Fatalf("ListByTenant(1) = %+v, %v", list, err)
	}
	if list, _ := repo.ListByTenant(ctx, 2); len(list) != 0 {
		t.Fatalf("ListByTenant(2) = %+v", list)
	}
	if err := repo.Delete(ctx, 2, k.ID); !errors.Is(err, apikey.ErrNotFound) {
		t.Fatalf("cross-tenant delete err = %v", err)
	}
	if err := repo.Delete(ctx, 1, k.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.FindByHash(ctx, "h1"); !errors.Is(err, apikey.ErrNotFound) {
		t.Fatalf("after delete err = %v", err)
	}
}
