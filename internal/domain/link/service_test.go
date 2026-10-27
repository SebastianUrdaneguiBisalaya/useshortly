package link

import (
	"context"
	"errors"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type fakeRepo struct {
	links     map[string]Link
	createErr error
	calls     int
	consumes  int
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{links: make(map[string]Link)}
}

func (r *fakeRepo) Create(_ context.Context, l Link) (Link, error) {
	r.calls++
	if r.createErr != nil {
		return Link{}, r.createErr
	}
	if _, ok := r.links[l.Code]; ok {
		return Link{}, ErrCodeTaken
	}
	l.ID = int64(len(r.links) + 1)
	r.links[l.Code] = l
	return l, nil
}

func (r *fakeRepo) FindByCode(_ context.Context, code string) (Link, error) {
	l, ok := r.links[code]
	if !ok {
		return Link{}, ErrNotFound
	}
	return l, nil
}

func (r *fakeRepo) FindByID(_ context.Context, tenantID, id int64) (Link, error) {
	for _, l := range r.links {
		if l.ID == id && l.TenantID == tenantID {
			return l, nil
		}
	}
	return Link{}, ErrNotFound
}

func (r *fakeRepo) ListByTenant(_ context.Context, tenantID int64, p page.Params) ([]Link, int, error) {
	var all []Link
	for _, l := range r.links {
		if l.TenantID == tenantID {
			all = append(all, l)
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ID > all[j].ID })
	lo := min(p.Offset, len(all))
	hi := min(lo+p.Limit, len(all))
	return all[lo:hi], len(all), nil
}

func (r *fakeRepo) Delete(_ context.Context, tenantID, id int64) error {
	for code, l := range r.links {
		if l.ID == id && l.TenantID == tenantID {
			delete(r.links, code)
			return nil
		}
	}
	return ErrNotFound
}

func (r *fakeRepo) ConsumeClick(_ context.Context, code string) error {
	r.consumes++
	l, ok := r.links[code]
	if !ok {
		return ErrNotFound
	}
	if l.MaxClicks != nil && l.ClickCount >= *l.MaxClicks {
		return ErrExpired
	}
	l.ClickCount++
	r.links[code] = l
	return nil
}

type fakeGen struct {
	codes []string
	i     int
	err   error
}

func (g *fakeGen) Generate() (string, error) {
	if g.err != nil {
		return "", g.err
	}
	c := g.codes[g.i%len(g.codes)]
	g.i++
	return c, nil
}

var fixedNow = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

// fakeHasher "hashes" by prefixing, so tests can see what was stored.
type fakeHasher struct {
	verifies int
	err      error
}

func (h *fakeHasher) Hash(password string) (string, error) { return "hash:" + password, nil }

func (h *fakeHasher) Verify(hash, password string) (bool, error) {
	h.verifies++
	if h.err != nil {
		return false, h.err
	}
	return hash == "hash:"+password, nil
}

// fakeLimiter counts attempts per key like the real one, without windows.
type fakeLimiter struct {
	counts map[string]int
	err    error
	resets []string
}

func newFakeLimiter() *fakeLimiter { return &fakeLimiter{counts: map[string]int{}} }

func (l *fakeLimiter) Take(_ context.Context, key string, limit int, _ time.Duration) (bool, error) {
	if l.err != nil {
		return false, l.err
	}
	l.counts[key]++
	return l.counts[key] <= limit, nil
}

func (l *fakeLimiter) Reset(_ context.Context, key string) error {
	l.resets = append(l.resets, key)
	delete(l.counts, key)
	return nil
}

func newSvc(repo Repository, gen CodeGenerator) *Service {
	s := NewService(repo, gen, &fakeHasher{}, newFakeLimiter())
	s.now = func() time.Time { return fixedNow }
	return s
}

func TestShorten(t *testing.T) {
	ctx := context.Background()

	t.Run("stores link with generated code for the tenant", func(t *testing.T) {
		repo := newFakeRepo()
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		l, err := s.Shorten(ctx, ShortenInput{TenantID: 3, UserID: 7, URL: "https://example.com/a?b=1"})
		require.NoError(t, err)
		assert.Equal(t, Link{
			ID: 1, Code: "abc1234", OriginURL: "https://example.com/a?b=1",
			TenantID: 3, CreatedBy: 7, CreatedAt: fixedNow,
		}, l)
		assert.Contains(t, repo.links, "abc1234")
	})

	t.Run("rejects invalid URLs", func(t *testing.T) {
		for _, raw := range []string{
			"",
			"not a URL",
			"ftp://example.com",
			"javascript:alert(1)",
			"https://",
			"https://example.com/" + strings.Repeat("a", 300),
		} {
			s := newSvc(newFakeRepo(), &fakeGen{codes: []string{"abc1234"}})
			_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: raw})
			assert.ErrorIs(t, err, ErrInvalidURL, raw)
		}
	})

	t.Run("retries on collision", func(t *testing.T) {
		repo := newFakeRepo()
		repo.links["dup0000"] = Link{Code: "dup0000"}
		s := newSvc(repo, &fakeGen{codes: []string{"dup0000", "dup0000", "new1111"}})
		l, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com"})
		require.NoError(t, err)
		assert.Equal(t, "new1111", l.Code)
	})

	t.Run("gives up after max retries", func(t *testing.T) {
		repo := newFakeRepo()
		repo.createErr = ErrCodeTaken
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com"})
		assert.ErrorIs(t, err, ErrCodeTaken)
		assert.Equal(t, maxRetries, repo.calls)
	})

	t.Run("propagates generator error", func(t *testing.T) {
		boom := errors.New("boom")
		s := newSvc(newFakeRepo(), &fakeGen{err: boom})
		_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com"})
		assert.ErrorIs(t, err, boom)
	})

	t.Run("propagates repository error without retry", func(t *testing.T) {
		boom := errors.New("db down")
		repo := newFakeRepo()
		repo.createErr = boom
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com"})
		assert.ErrorIs(t, err, boom)
		assert.Equal(t, 1, repo.calls)
	})
}

func TestResolve(t *testing.T) {
	ctx := context.Background()
	past := fixedNow.Add(-time.Hour)
	future := fixedNow.Add(time.Hour)
	repo := newFakeRepo()
	repo.links["live000"] = Link{Code: "live000", OriginURL: "https://example.com/live", ExpiresAt: &future}
	repo.links["forever"] = Link{Code: "forever", OriginURL: "https://example.com/forever"}
	repo.links["dead000"] = Link{Code: "dead000", OriginURL: "https://example.com/dead", ExpiresAt: &past}
	s := newSvc(repo, &fakeGen{codes: []string{"x"}})

	tests := []struct {
		name    string
		code    string
		want    string
		wantErr error
	}{
		{"active link", "live000", "https://example.com/live", nil},
		{"no expiry", "forever", "https://example.com/forever", nil},
		{"expired", "dead000", "", ErrExpired},
		{"unknown", "nope000", "", ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := s.Resolve(ctx, tt.code)
			assert.ErrorIs(t, err, tt.wantErr)
			assert.Equal(t, tt.want, got.OriginURL)
		})
	}
}

// Regression: `now: time.Now().UTC` froze the clock at construction time.
func TestClockAdvancesAndIsUTC(t *testing.T) {
	s := NewService(nil, nil, nil, nil)
	a := s.now()
	time.Sleep(5 * time.Millisecond)
	b := s.now()
	assert.True(t, b.After(a), "the clock must keep moving")
	assert.Equal(t, time.UTC, a.Location())
}

func TestValidateAlias(t *testing.T) {
	tests := []struct {
		name    string
		alias   string
		wantErr error
	}{
		{"valid", "promo-2026", nil},
		{"valid with underscore", "my_link_2", nil},
		{"min length", "abc", nil},
		{"max length", strings.Repeat("a", maxAliasLen), nil},
		{"too short", "ab", ErrInvalidAlias},
		{"too long", strings.Repeat("a", maxAliasLen+1), ErrInvalidAlias},
		{"same length as generated codes", "ofertas", ErrInvalidAlias},
		{"slash", "a/b-c", ErrInvalidAlias},
		{"space", "my link", ErrInvalidAlias},
		{"non ascii", "añade", ErrInvalidAlias},
		{"reserved", "admin", ErrInvalidAlias},
		{"reserved uppercase", "API", ErrInvalidAlias},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.ErrorIs(t, validateAlias(tt.alias), tt.wantErr)
		})
	}
}

func TestShortenAlias(t *testing.T) {
	ctx := context.Background()

	t.Run("stores the link under the alias", func(t *testing.T) {
		repo := newFakeRepo()
		gen := &fakeGen{codes: []string{"abc1234"}}
		s := newSvc(repo, gen)
		l, err := s.Shorten(ctx, ShortenInput{TenantID: 3, UserID: 7, URL: "https://example.com", Alias: "promo"})
		require.NoError(t, err)
		assert.Equal(t, "promo", l.Code)
		assert.Contains(t, repo.links, "promo")
		assert.Zero(t, gen.i, "the generator must not be used")
	})

	t.Run("rejects an invalid alias without touching the repository", func(t *testing.T) {
		repo := newFakeRepo()
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", Alias: "a/b"})
		assert.ErrorIs(t, err, ErrInvalidAlias)
		assert.Zero(t, repo.calls)
	})

	t.Run("alias taken is reported once, without retries", func(t *testing.T) {
		repo := newFakeRepo()
		repo.links["promo"] = Link{Code: "promo"}
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", Alias: "promo"})
		assert.ErrorIs(t, err, ErrAliasTaken)
		assert.Equal(t, 1, repo.calls)
	})

	t.Run("propagates repository error", func(t *testing.T) {
		boom := errors.New("db down")
		repo := newFakeRepo()
		repo.createErr = boom
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", Alias: "promo"})
		assert.ErrorIs(t, err, boom)
	})
}

func TestShortenExpiration(t *testing.T) {
	ctx := context.Background()
	past := fixedNow.Add(-time.Hour)
	future := fixedNow.Add(time.Hour)
	zero, neg, three := int64(0), int64(-1), int64(3)

	t.Run("stores expires_at in UTC and max_clicks", func(t *testing.T) {
		repo := newFakeRepo()
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		local := future.In(time.FixedZone("UTC-5", -5*3600))
		l, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", ExpiresAt: &local, MaxClicks: &three})
		require.NoError(t, err)
		require.NotNil(t, l.ExpiresAt)
		assert.Equal(t, time.UTC, l.ExpiresAt.Location())
		assert.True(t, l.ExpiresAt.Equal(future))
		assert.Equal(t, &three, l.MaxClicks)
	})

	t.Run("rejects expires_at that is not in the future", func(t *testing.T) {
		for name, at := range map[string]time.Time{"past": past, "now": fixedNow} {
			s := newSvc(newFakeRepo(), &fakeGen{codes: []string{"abc1234"}})
			_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", ExpiresAt: &at})
			assert.ErrorIs(t, err, ErrInvalidExpiry, name)
		}
	})

	t.Run("rejects max_clicks below 1", func(t *testing.T) {
		for _, n := range []*int64{&zero, &neg} {
			repo := newFakeRepo()
			s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
			_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", MaxClicks: n})
			assert.ErrorIs(t, err, ErrInvalidMaxClicks, "%d", *n)
			assert.Zero(t, repo.calls)
		}
	})

	t.Run("applies to aliases too", func(t *testing.T) {
		repo := newFakeRepo()
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", Alias: "promo", MaxClicks: &zero})
		assert.ErrorIs(t, err, ErrInvalidMaxClicks)
		assert.Zero(t, repo.calls)
	})
}

func TestResolveMaxClicks(t *testing.T) {
	ctx := context.Background()
	two := int64(2)
	repo := newFakeRepo()
	repo.links["limit00"] = Link{Code: "limit00", OriginURL: "https://example.com/limit", MaxClicks: &two}
	repo.links["free000"] = Link{Code: "free000", OriginURL: "https://example.com/free"}
	s := newSvc(repo, &fakeGen{codes: []string{"x"}})

	t.Run("serves the link until it uses all its clicks", func(t *testing.T) {
		for range 2 {
			got, err := s.Resolve(ctx, "limit00")
			require.NoError(t, err)
			assert.Equal(t, "https://example.com/limit", got.OriginURL)
		}
		_, err := s.Resolve(ctx, "limit00")
		assert.ErrorIs(t, err, ErrExpired)
		assert.EqualValues(t, 2, repo.links["limit00"].ClickCount)
	})

	t.Run("unlimited links never touch the counter", func(t *testing.T) {
		before := repo.consumes
		_, err := s.Resolve(ctx, "free000")
		require.NoError(t, err)
		assert.Equal(t, before, repo.consumes)
	})

	t.Run("a link already out of clicks is expired before counting", func(t *testing.T) {
		repo.links["spent00"] = Link{Code: "spent00", MaxClicks: &two, ClickCount: 2}
		before := repo.consumes
		_, err := s.Resolve(ctx, "spent00")
		assert.ErrorIs(t, err, ErrExpired)
		assert.Equal(t, before, repo.consumes)
	})
}

func TestIsExpired(t *testing.T) {
	past, future := fixedNow.Add(-time.Hour), fixedNow.Add(time.Hour)
	two := int64(2)
	tests := []struct {
		name string
		l    Link
		want bool
	}{
		{"no limits", Link{}, false},
		{"date in the past", Link{ExpiresAt: &past}, true},
		{"date in the future", Link{ExpiresAt: &future}, false},
		{"clicks left", Link{MaxClicks: &two, ClickCount: 1}, false},
		{"clicks used", Link{MaxClicks: &two, ClickCount: 2}, true},
		{"date ok but clicks used", Link{ExpiresAt: &future, MaxClicks: &two, ClickCount: 2}, true},
		{"clicks left but date passed", Link{ExpiresAt: &past, MaxClicks: &two}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.l.IsExpired(fixedNow))
		})
	}
}

func TestGetIsScopedToTenant(t *testing.T) {
	ctx := context.Background()
	s := newSvc(newFakeRepo(), &fakeGen{codes: []string{"aaaaaaa"}})
	l, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com"})
	require.NoError(t, err)

	got, err := s.Get(ctx, 1, l.ID)
	require.NoError(t, err)
	assert.Equal(t, l.Code, got.Code)
	_, err = s.Get(ctx, 2, l.ID)
	assert.ErrorIs(t, err, ErrNotFound, "another tenant's link looks like an unknown one")
	_, err = s.Get(ctx, 1, 999)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestListAndDeleteAreScopedToTenant(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	s := newSvc(repo, &fakeGen{codes: []string{"aaaaaaa", "bbbbbbb", "ccccccc", "ddddddd"}})
	var mine []Link
	for _, tenant := range []int64{1, 1, 1, 2} {
		l, err := s.Shorten(ctx, ShortenInput{TenantID: tenant, UserID: 1, URL: "https://example.com"})
		require.NoError(t, err)
		if tenant == 1 {
			mine = append(mine, l)
		}
	}

	t.Run("lists one page, newest first, with the tenant's total", func(t *testing.T) {
		list, total, err := s.List(ctx, 1, page.Params{Limit: 2})
		require.NoError(t, err)
		assert.Equal(t, 3, total)
		require.Len(t, list, 2)
		assert.Equal(t, mine[2].Code, list[0].Code)
		assert.Equal(t, mine[1].Code, list[1].Code)

		list, _, err = s.List(ctx, 1, page.Params{Limit: 2, Offset: 2})
		require.NoError(t, err)
		require.Len(t, list, 1)
		assert.Equal(t, mine[0].Code, list[0].Code)
	})

	t.Run("an empty window falls back to the default limit", func(t *testing.T) {
		list, _, err := s.List(ctx, 1, page.Params{})
		require.NoError(t, err)
		assert.Len(t, list, 3)
	})

	t.Run("another tenant cannot delete my link", func(t *testing.T) {
		assert.ErrorIs(t, s.Delete(ctx, 2, mine[0].ID), ErrNotFound)
		assert.Contains(t, repo.links, mine[0].Code)
	})

	t.Run("owner deletes it and it stops resolving", func(t *testing.T) {
		require.NoError(t, s.Delete(ctx, 1, mine[0].ID))
		_, err := s.Resolve(ctx, mine[0].Code)
		assert.ErrorIs(t, err, ErrNotFound)
		assert.ErrorIs(t, s.Delete(ctx, 1, mine[0].ID), ErrNotFound)
	})
}

func newProtected(t *testing.T) (*Service, *fakeRepo, *fakeHasher, *fakeLimiter, Link) {
	t.Helper()
	repo, hasher, limiter := newFakeRepo(), &fakeHasher{}, newFakeLimiter()
	s := NewService(repo, &fakeGen{codes: []string{"abc1234"}}, hasher, limiter)
	s.now = func() time.Time { return fixedNow }
	l, err := s.Shorten(context.Background(), ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com/secret", Password: "hunter22"})
	require.NoError(t, err)
	hasher.verifies = 0
	return s, repo, hasher, limiter, l
}

func TestShortenWithPassword(t *testing.T) {
	ctx := context.Background()

	t.Run("stores only the hash", func(t *testing.T) {
		_, repo, _, _, l := newProtected(t)
		assert.True(t, l.Protected())
		assert.Equal(t, "hash:hunter22", repo.links["abc1234"].PasswordHash)
		assert.NotContains(t, repo.links["abc1234"].PasswordHash, "hunter22 ", "never the plain password")
	})

	t.Run("no password, no protection", func(t *testing.T) {
		s := newSvc(newFakeRepo(), &fakeGen{codes: []string{"abc1234"}})
		l, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com"})
		require.NoError(t, err)
		assert.False(t, l.Protected())
	})

	t.Run("rejects passwords of the wrong length without storing", func(t *testing.T) {
		for _, pw := range []string{"abc", strings.Repeat("a", maxPasswordLen+1)} {
			repo := newFakeRepo()
			s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
			_, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", Password: pw})
			assert.ErrorIs(t, err, ErrInvalidPassword, "%d chars", len(pw))
			assert.Zero(t, repo.calls)
		}
	})

	t.Run("accepts the limits and works with an alias", func(t *testing.T) {
		s := newSvc(newFakeRepo(), &fakeGen{codes: []string{"abc1234"}})
		for alias, pw := range map[string]string{"pw-short": "abcd", "pw-lengthy": strings.Repeat("a", maxPasswordLen)} {
			l, err := s.Shorten(ctx, ShortenInput{TenantID: 1, UserID: 1, URL: "https://example.com", Alias: alias, Password: pw})
			require.NoError(t, err, alias)
			assert.True(t, l.Protected(), alias)
		}
	})
}

func TestResolveDoesNotServeAProtectedLink(t *testing.T) {
	ctx := context.Background()
	s, repo, _, _, _ := newProtected(t)

	got, err := s.Resolve(ctx, "abc1234")
	assert.ErrorIs(t, err, ErrPasswordRequired)
	assert.Equal(t, "abc1234", got.Code, "the link comes back so the caller can pick its unlock page")
	assert.Zero(t, repo.consumes)

	t.Run("an expired protected link is expired, not locked", func(t *testing.T) {
		past := fixedNow.Add(-time.Hour)
		repo.links["old0000"] = Link{Code: "old0000", PasswordHash: "hash:x", ExpiresAt: &past}
		_, err := s.Resolve(ctx, "old0000")
		assert.ErrorIs(t, err, ErrExpired)
	})
}

func TestUnlock(t *testing.T) {
	ctx := context.Background()

	t.Run("right password serves the link and clears the attempts", func(t *testing.T) {
		s, _, _, limiter, _ := newProtected(t)
		got, err := s.Unlock(ctx, "abc1234", "hunter22", "203.0.113.7")
		require.NoError(t, err)
		assert.Equal(t, "https://example.com/secret", got.OriginURL)
		assert.Equal(t, []string{"unlock:abc1234:203.0.113.7"}, limiter.resets)
		assert.Empty(t, limiter.counts)
	})

	t.Run("wrong password", func(t *testing.T) {
		s, _, _, limiter, _ := newProtected(t)
		got, err := s.Unlock(ctx, "abc1234", "nope", "203.0.113.7")
		assert.ErrorIs(t, err, ErrWrongPassword)
		assert.Equal(t, "abc1234", got.Code, "the link comes back to render the page again")
		assert.Equal(t, 1, limiter.counts["unlock:abc1234:203.0.113.7"])
		assert.Empty(t, limiter.resets)
	})

	t.Run("three tries, then blocked even with the right password", func(t *testing.T) {
		s, _, hasher, _, _ := newProtected(t)
		for range 3 {
			_, err := s.Unlock(ctx, "abc1234", "nope", "203.0.113.7")
			assert.ErrorIs(t, err, ErrWrongPassword)
		}
		_, err := s.Unlock(ctx, "abc1234", "hunter22", "203.0.113.7")
		assert.ErrorIs(t, err, ErrTooManyAttempts)
		assert.Equal(t, 3, hasher.verifies, "the blocked attempt never looks at the password")
	})

	t.Run("a right try counts too, but clears the count", func(t *testing.T) {
		s, _, _, limiter, _ := newProtected(t)
		for range 2 {
			_, _ = s.Unlock(ctx, "abc1234", "nope", "v")
		}
		_, err := s.Unlock(ctx, "abc1234", "hunter22", "v")
		require.NoError(t, err, "the third try is still allowed")
		assert.Empty(t, limiter.counts)
		_, err = s.Unlock(ctx, "abc1234", "nope", "v")
		assert.ErrorIs(t, err, ErrWrongPassword, "a fresh window after a success")
	})

	t.Run("each visitor and each link has its own tries", func(t *testing.T) {
		s, repo, _, _, _ := newProtected(t)
		repo.links["other00"] = Link{Code: "other00", OriginURL: "https://example.com/o", PasswordHash: "hash:pw12"}
		for range 3 {
			_, _ = s.Unlock(ctx, "abc1234", "nope", "1.1.1.1")
		}
		_, err := s.Unlock(ctx, "abc1234", "hunter22", "2.2.2.2")
		assert.NoError(t, err, "another visitor")
		_, err = s.Unlock(ctx, "other00", "pw12", "1.1.1.1")
		assert.NoError(t, err, "another link")
	})

	t.Run("max_clicks counts only a successful unlock", func(t *testing.T) {
		s, repo, _, _, _ := newProtected(t)
		one := int64(1)
		l := repo.links["abc1234"]
		l.MaxClicks = &one
		repo.links["abc1234"] = l
		_, _ = s.Unlock(ctx, "abc1234", "nope", "v")
		assert.Zero(t, repo.consumes)
		_, err := s.Unlock(ctx, "abc1234", "hunter22", "v")
		require.NoError(t, err)
		assert.Equal(t, 1, repo.consumes)
		_, err = s.Unlock(ctx, "abc1234", "hunter22", "v")
		assert.ErrorIs(t, err, ErrExpired, "the link used its only click")
	})

	t.Run("unknown and expired links are not attempts", func(t *testing.T) {
		s, repo, _, limiter, _ := newProtected(t)
		_, err := s.Unlock(ctx, "nope000", "x", "v")
		assert.ErrorIs(t, err, ErrNotFound)
		past := fixedNow.Add(-time.Hour)
		repo.links["old0000"] = Link{Code: "old0000", PasswordHash: "hash:x", ExpiresAt: &past}
		_, err = s.Unlock(ctx, "old0000", "x", "v")
		assert.ErrorIs(t, err, ErrExpired)
		assert.Empty(t, limiter.counts)
	})

	t.Run("a link without password is just served", func(t *testing.T) {
		s, repo, _, limiter, _ := newProtected(t)
		repo.links["open000"] = Link{Code: "open000", OriginURL: "https://example.com/open"}
		got, err := s.Unlock(ctx, "open000", "whatever", "v")
		require.NoError(t, err)
		assert.Equal(t, "https://example.com/open", got.OriginURL)
		assert.Empty(t, limiter.counts)
	})

	t.Run("fails closed when the limiter is down", func(t *testing.T) {
		s, _, hasher, limiter, _ := newProtected(t)
		limiter.err = errors.New("redis down")
		_, err := s.Unlock(ctx, "abc1234", "hunter22", "v")
		assert.Error(t, err)
		assert.NotErrorIs(t, err, ErrWrongPassword)
		assert.Zero(t, hasher.verifies, "no unlimited guessing while the limiter is unavailable")
	})

	t.Run("a broken stored hash is an error, not a wrong password", func(t *testing.T) {
		s, _, hasher, _, _ := newProtected(t)
		hasher.err = errors.New("malformed hash")
		_, err := s.Unlock(ctx, "abc1234", "hunter22", "v")
		assert.Error(t, err)
		assert.NotErrorIs(t, err, ErrWrongPassword)
	})
}
