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
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/domain"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/unlockpage"
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

	got, err := repo.FindByCode(ctx, nil, "abc1234")
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

	_, err = repo.FindByCode(ctx, nil, "nope000")
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

	got, err := repo.FindByCode(ctx, nil, "limit00")
	require.NoError(t, err)
	assert.Equal(t, &two, got.MaxClicks)
	assert.Zero(t, got.ClickCount)

	require.NoError(t, repo.ConsumeClick(ctx, got.ID))
	require.NoError(t, repo.ConsumeClick(ctx, got.ID))
	assert.ErrorIs(t, repo.ConsumeClick(ctx, got.ID), link.ErrExpired)
	got, err = repo.FindByCode(ctx, nil, "limit00")
	require.NoError(t, err)
	assert.EqualValues(t, 2, got.ClickCount)

	free, err := repo.FindByCode(ctx, nil, "free000")
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

	list, total, err := repo.ListByTenant(ctx, 1, link.ListFilter{}, page.Params{Limit: 2})
	require.NoError(t, err)
	assert.Equal(t, 3, total, "total ignores the window and the other tenant")
	require.Len(t, list, 2)
	assert.Equal(t, "ccccccc", list[0].Code, "newest first")
	assert.Equal(t, "bbbbbbb", list[1].Code)

	list, _, err = repo.ListByTenant(ctx, 1, link.ListFilter{}, page.Params{Limit: 2, Offset: 2})
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "aaaaaaa", list[0].Code)
	assert.Equal(t, &two, list[0].MaxClicks, "list rows carry every column")

	byID, err := repo.FindByID(ctx, 1, ids[1])
	require.NoError(t, err)
	assert.Equal(t, "bbbbbbb", byID.Code)
	_, err = repo.FindByID(ctx, 2, ids[1])
	assert.ErrorIs(t, err, link.ErrNotFound, "another tenant's link is not found")
	_, err = repo.FindByID(ctx, 1, 9999)
	assert.ErrorIs(t, err, link.ErrNotFound)

	list, total, err = repo.ListByTenant(ctx, 3, link.ListFilter{}, page.Params{Limit: 10})
	require.NoError(t, err)
	assert.Empty(t, list)
	assert.Zero(t, total)

	assert.ErrorIs(t, repo.Delete(ctx, 2, ids[0]), link.ErrNotFound, "another tenant's link is not found")
	_, err = repo.FindByCode(ctx, nil, "aaaaaaa")
	require.NoError(t, err)
	require.NoError(t, repo.Delete(ctx, 1, ids[0]))
	_, err = repo.FindByCode(ctx, nil, "aaaaaaa")
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

func TestClickRepositoryStats(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	links := NewLinkRepository(db)
	clicks := NewClickRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	for _, name := range []string{"acme", "other"} {
		_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES (?)`, name)
		require.NoError(t, err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	mine, err := links.Create(ctx, link.Link{Code: "mine000", OriginURL: "https://example.com/m", TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)
	theirs, err := links.Create(ctx, link.Link{Code: "their00", OriginURL: "https://example.com/t", TenantID: 2, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)

	at := func(s string) time.Time { return time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC).Add(mustDuration(t, s)) }
	add := func(linkID int64, when time.Time, referrer, country, device string) {
		_, err := clicks.Create(ctx, analytics.Click{LinkID: linkID, At: when, Referrer: referrer, Country: country, Device: device})
		require.NoError(t, err)
	}
	add(mine.ID, at("0h"), "https://a.example", "PE", "mobile")        // 03-01 00:00, first instant of the window
	add(mine.ID, at("23h59m"), "https://a.example", "PE", "mobile")    // 03-01
	add(mine.ID, at("24h"), "", "US", "desktop")                       // 03-02
	add(mine.ID, at("49h"), "https://b.example", "", "")               // 03-03
	add(mine.ID, at("-1ms"), "https://old.example", "ES", "bot")       // 02-28 23:59:59.999: before the window
	add(mine.ID, at("72h"), "https://late.example", "ES", "bot")       // 03-04 00:00: first instant after it
	add(theirs.ID, at("1h"), "https://other.example", "FR", "desktop") // another tenant's link

	from, to := at("0h"), at("72h") // [03-01, 03-04)
	st, err := clicks.Stats(ctx, 1, mine.ID, from, to, time.UTC, analytics.Filter{})
	require.NoError(t, err)

	assert.EqualValues(t, 4, st.Total)
	assert.Equal(t, []analytics.DayCount{{Date: "2026-03-01", Clicks: 2}, {Date: "2026-03-02", Clicks: 1}, {Date: "2026-03-03", Clicks: 1}}, st.Daily, "only days with clicks")
	assert.Equal(t, []analytics.Count{{Name: "https://a.example", Clicks: 2}, {Name: "", Clicks: 1}, {Name: "https://b.example", Clicks: 1}}, st.Referrers,
		"most frequent first, ties by name")
	assert.Equal(t, []analytics.Count{{Name: "PE", Clicks: 2}, {Name: "", Clicks: 1}, {Name: "US", Clicks: 1}}, st.Countries)
	assert.Equal(t, []analytics.Count{{Name: "mobile", Clicks: 2}, {Name: "", Clicks: 1}, {Name: "desktop", Clicks: 1}}, st.Devices)

	wantHours := make([]int64, 24)
	wantHours[0], wantHours[1], wantHours[23] = 2, 1, 1 // 00:00 twice, 01:00, 23:59
	assert.Equal(t, wantHours, st.ByHour)
	assert.Equal(t, []int64{2, 1, 1, 0, 0, 0, 0}, st.ByWeekday, "03-01 is a Sunday")

	pe := "PE"
	onlyPE, err := clicks.Stats(ctx, 1, mine.ID, from, to, time.UTC, analytics.Filter{Country: &pe})
	require.NoError(t, err)
	assert.EqualValues(t, 2, onlyPE.Total)
	direct, none := "", ""
	noReferrer, err := clicks.Total(ctx, 1, mine.ID, from, to, analytics.Filter{Referrer: &direct, Device: &none})
	require.NoError(t, err)
	assert.EqualValues(t, 0, noReferrer, "the direct click has a device")
	directOnly, err := clicks.Total(ctx, 1, mine.ID, from, to, analytics.Filter{Referrer: &direct})
	require.NoError(t, err)
	assert.EqualValues(t, 1, directOnly)

	empty, err := clicks.Stats(ctx, 1, mine.ID, at("500h"), at("600h"), time.UTC, analytics.Filter{})
	require.NoError(t, err)
	assert.Zero(t, empty.Total)
	assert.Empty(t, empty.Daily)

	_, err = clicks.Stats(ctx, 2, mine.ID, from, to, time.UTC, analytics.Filter{})
	assert.ErrorIs(t, err, analytics.ErrNotFound, "another tenant cannot read my link's stats")
	_, err = clicks.Stats(ctx, 1, 9999, from, to, time.UTC, analytics.Filter{})
	assert.ErrorIs(t, err, analytics.ErrNotFound)

	for i := 0; i < analytics.TopN+5; i++ {
		add(mine.ID, at("1h"), "https://many.example/"+string(rune('a'+i)), "", "")
	}
	capped, err := clicks.Stats(ctx, 1, mine.ID, from, to, time.UTC, analytics.Filter{})
	require.NoError(t, err)
	assert.Len(t, capped.Referrers, analytics.TopN)
}

func mustDuration(t *testing.T, s string) time.Duration {
	t.Helper()
	d, err := time.ParseDuration(s)
	require.NoError(t, err)
	return d
}

func TestLinkRepositoryPasswordHash(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	repo := NewLinkRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)
	_, err = repo.Create(ctx, link.Link{Code: "locked0", OriginURL: "https://example.com", PasswordHash: "$argon2id$x", TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)
	_, err = repo.Create(ctx, link.Link{Code: "open000", OriginURL: "https://example.com", TenantID: 1, CreatedBy: u.ID, CreatedAt: now})
	require.NoError(t, err)

	locked, err := repo.FindByCode(ctx, nil, "locked0")
	require.NoError(t, err)
	assert.Equal(t, "$argon2id$x", locked.PasswordHash)
	assert.True(t, locked.Protected())
	open, err := repo.FindByCode(ctx, nil, "open000")
	require.NoError(t, err)
	assert.False(t, open.Protected())

	list, _, err := repo.ListByTenant(ctx, 1, link.ListFilter{}, page.Params{Limit: 10})
	require.NoError(t, err)
	require.Len(t, list, 2)
	assert.True(t, list[1].Protected(), "lists carry the flag too")
	byID, err := repo.FindByID(ctx, 1, locked.ID)
	require.NoError(t, err)
	assert.True(t, byID.Protected())
}

func TestUnlockPageRepository(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	links := NewLinkRepository(db)
	pages := NewUnlockPageRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	for _, name := range []string{"acme", "other"} {
		_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES (?)`, name)
		require.NoError(t, err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	mk := func(code string, tenant int64) link.Link {
		l, err := links.Create(ctx, link.Link{Code: code, OriginURL: "https://example.com", TenantID: tenant, CreatedBy: u.ID, CreatedAt: now})
		require.NoError(t, err)
		return l
	}
	one, two, foreign := mk("one0000", 1), mk("two0000", 1), mk("for0000", 2)
	mkPage := func(tenant int64, linkID *int64, html string) unlockpage.Page {
		return unlockpage.Page{TenantID: tenant, LinkID: linkID, HTML: html, UpdatedBy: u.ID, UpdatedAt: now}
	}

	_, err := pages.Find(ctx, 1, one.ID)
	assert.ErrorIs(t, err, unlockpage.ErrNotFound)

	org, err := pages.Upsert(ctx, mkPage(1, nil, "<p>org v1</p>"))
	require.NoError(t, err)
	assert.Nil(t, org.LinkID)
	assert.True(t, org.UpdatedAt.Equal(now))
	again, err := pages.Upsert(ctx, mkPage(1, nil, "<p>org v2</p>"))
	require.NoError(t, err)
	assert.Equal(t, org.ID, again.ID, "replaced, not duplicated")
	assert.Equal(t, "<p>org v2</p>", again.HTML)

	own, err := pages.Upsert(ctx, mkPage(1, &one.ID, "<p>one</p>"))
	require.NoError(t, err)
	require.NotNil(t, own.LinkID)
	assert.Equal(t, one.ID, *own.LinkID)
	again, err = pages.Upsert(ctx, mkPage(1, &one.ID, "<p>one v2</p>"))
	require.NoError(t, err)
	assert.Equal(t, own.ID, again.ID)

	got, err := pages.Find(ctx, 1, one.ID)
	require.NoError(t, err)
	assert.Equal(t, "<p>one v2</p>", got.HTML, "the link's own page wins")
	got, err = pages.Find(ctx, 1, two.ID)
	require.NoError(t, err)
	assert.Equal(t, "<p>org v2</p>", got.HTML, "other links use the organization's")
	_, err = pages.Find(ctx, 2, foreign.ID)
	assert.ErrorIs(t, err, unlockpage.ErrNotFound, "another organization has no page")

	_, err = pages.Upsert(ctx, mkPage(1, &foreign.ID, "<p>x</p>"))
	assert.ErrorIs(t, err, unlockpage.ErrNotFound, "a page for another organization's link is refused")
	_, err = pages.Upsert(ctx, mkPage(1, new(int64), "<p>x</p>"))
	assert.ErrorIs(t, err, unlockpage.ErrNotFound, "and for a link that does not exist")

	exact, err := pages.Get(ctx, 1, nil)
	require.NoError(t, err)
	assert.Equal(t, org.ID, exact.ID)
	_, err = pages.Get(ctx, 1, &two.ID)
	assert.ErrorIs(t, err, unlockpage.ErrNotFound, "Get is exact: no fallback")

	assert.ErrorIs(t, pages.Delete(ctx, 2, u.ID, nil, now), unlockpage.ErrNotFound)
	require.NoError(t, pages.Delete(ctx, 1, u.ID, &one.ID, now))
	got, err = pages.Find(ctx, 1, one.ID)
	require.NoError(t, err)
	assert.Equal(t, "<p>org v2</p>", got.HTML, "back to the organization's page")

	_, err = pages.Upsert(ctx, mkPage(1, &two.ID, "<p>two</p>"))
	require.NoError(t, err)
	require.NoError(t, links.Delete(ctx, 1, two.ID))
	_, err = pages.Get(ctx, 1, &two.ID)
	assert.ErrorIs(t, err, unlockpage.ErrNotFound, "a link's page goes with the link")

	_, err = db.ExecContext(ctx, `INSERT INTO unlock_pages (tenant_id, html, updated_by, updated_at) VALUES (1, '', 1, 'x')`)
	assert.Error(t, err, "the database refuses an empty page")

	assert.EqualValues(t, u.ID, org.UpdatedBy)
	events, total, err := pages.History(ctx, 1, page.Params{Limit: 3})
	require.NoError(t, err)
	assert.Equal(t, 6, total, "two org sets, two link sets, two deletes; failed ones leave nothing")
	require.Len(t, events, 3)
	assert.Equal(t, unlockpage.ActionSet, events[0].Action, "newest first: the link two's page")
	require.NotNil(t, events[0].LinkID)
	assert.Equal(t, two.ID, *events[0].LinkID)
	assert.Equal(t, unlockpage.ActionDelete, events[1].Action)
	assert.EqualValues(t, u.ID, events[1].UserID)
	assert.True(t, events[1].At.Equal(now))
	_, total, err = pages.History(ctx, 2, page.Params{Limit: 10})
	require.NoError(t, err)
	assert.Zero(t, total)

	// The trail stays after the link and its page are gone.
	var n int
	require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM unlock_page_events WHERE link_id = ?`, two.ID).Scan(&n))
	assert.Equal(t, 1, n)
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

func TestDomainRepositoryAndLinksPerDomain(t *testing.T) {
	ctx := context.Background()
	db := newDB(t)
	domains, links := NewDomainRepository(db), NewLinkRepository(db)
	u := newUser(t, NewUserRepository(db), "ana@example.com")
	_, err := db.ExecContext(ctx, `INSERT INTO organizations (name) VALUES ('acme'), ('globex')`)
	require.NoError(t, err)
	now := time.Now().UTC().Truncate(time.Millisecond)

	d, err := domains.Create(ctx, domain.Domain{TenantID: 1, Host: "go.acme.test", CreatedAt: now})
	require.NoError(t, err)
	_, err = domains.Create(ctx, domain.Domain{TenantID: 2, Host: "go.acme.test", CreatedAt: now})
	assert.ErrorIs(t, err, domain.ErrHostTaken)

	got, err := domains.FindByHost(ctx, "go.acme.test")
	require.NoError(t, err)
	assert.Equal(t, d.ID, got.ID)
	assert.Nil(t, got.VerifiedAt)
	_, err = domains.FindByID(ctx, 2, d.ID)
	assert.ErrorIs(t, err, domain.ErrNotFound, "another tenant's id looks unknown")
	_, err = domains.FindByHost(ctx, "nope.test")
	assert.ErrorIs(t, err, domain.ErrNotFound)

	at := now.Add(time.Minute)
	require.NoError(t, domains.MarkVerified(ctx, 1, d.ID, at))
	assert.ErrorIs(t, domains.MarkVerified(ctx, 2, d.ID, at), domain.ErrNotFound)
	got, err = domains.FindByID(ctx, 1, d.ID)
	require.NoError(t, err)
	assert.True(t, got.VerifiedAt.Equal(at))

	list, total, err := domains.ListByTenant(ctx, 1, page.Params{Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	assert.Len(t, list, 1)

	// The same code is allowed once per domain, and each lookup finds its own link.
	mk := func(domainID *int64, origin string) (link.Link, error) {
		return links.Create(ctx, link.Link{Code: "promo00", OriginURL: origin, TenantID: 1, DomainID: domainID, CreatedBy: u.ID, CreatedAt: now})
	}
	onDefault, err := mk(nil, "https://example.com/default")
	require.NoError(t, err)
	onDomain, err := mk(&d.ID, "https://example.com/domain")
	require.NoError(t, err)
	assert.Equal(t, "go.acme.test", onDomain.DomainHost)
	_, err = mk(nil, "https://example.com/again")
	assert.ErrorIs(t, err, link.ErrCodeTaken)
	_, err = mk(&d.ID, "https://example.com/again")
	assert.ErrorIs(t, err, link.ErrCodeTaken)

	f, err := links.FindByCode(ctx, nil, "promo00")
	require.NoError(t, err)
	assert.Equal(t, onDefault.ID, f.ID)
	assert.Empty(t, f.DomainHost)
	f, err = links.FindByCode(ctx, &d.ID, "promo00")
	require.NoError(t, err)
	assert.Equal(t, onDomain.ID, f.ID)
	assert.Equal(t, "go.acme.test", f.DomainHost)
	other := d.ID + 99
	_, err = links.FindByCode(ctx, &other, "promo00")
	assert.ErrorIs(t, err, link.ErrNotFound)

	// Deleting the domain removes its links only.
	require.NoError(t, domains.Delete(ctx, 1, d.ID))
	assert.ErrorIs(t, domains.Delete(ctx, 1, d.ID), domain.ErrNotFound)
	_, err = links.FindByCode(ctx, &d.ID, "promo00")
	assert.ErrorIs(t, err, link.ErrNotFound)
	_, err = links.FindByCode(ctx, nil, "promo00")
	assert.NoError(t, err)
}

func TestUserRepositoryListProviders(t *testing.T) {
	ctx := context.Background()
	repo := NewUserRepository(newDB(t))
	u := newUser(t, repo, "prov@example.com")
	got, err := repo.ListProviders(ctx, u.ID)
	require.NoError(t, err)
	assert.Equal(t, []user.Provider{user.ProviderDefault}, got)

	got, err = repo.ListProviders(ctx, 999)
	require.NoError(t, err)
	assert.NotNil(t, got)
	assert.Empty(t, got)
}
