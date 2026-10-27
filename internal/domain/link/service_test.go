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

func newSvc(repo Repository, gen CodeGenerator) *Service {
	s := NewService(repo, gen)
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
	s := NewService(nil, nil)
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
