package cached

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type memStore struct {
	data    map[string][]byte
	ttls    map[string]time.Duration
	failGet bool
	failSet bool
	failDel bool
}

func newMemStore() *memStore {
	return &memStore{data: map[string][]byte{}, ttls: map[string]time.Duration{}}
}

var errCache = errors.New("redis down")

func (s *memStore) Get(_ context.Context, key string) ([]byte, bool, error) {
	if s.failGet {
		return nil, false, errCache
	}
	v, ok := s.data[key]
	return v, ok, nil
}

func (s *memStore) Set(_ context.Context, key string, value []byte, ttl time.Duration) error {
	if s.failSet {
		return errCache
	}
	s.data[key], s.ttls[key] = value, ttl
	return nil
}

func (s *memStore) Del(_ context.Context, keys ...string) error {
	if s.failDel {
		return errCache
	}
	for _, k := range keys {
		delete(s.data, k)
	}
	return nil
}

// countingRepo is the wrapped repository: it counts how often each read reaches it.
type countingRepo struct {
	links    map[string]link.Link
	finds    int
	consumes int
}

func (r *countingRepo) Create(_ context.Context, l link.Link) (link.Link, error) {
	r.links[l.Code] = l
	return l, nil
}

func (r *countingRepo) FindByCode(_ context.Context, code string) (link.Link, error) {
	r.finds++
	l, ok := r.links[code]
	if !ok {
		return link.Link{}, link.ErrNotFound
	}
	return l, nil
}

func (r *countingRepo) FindByID(_ context.Context, tenantID, id int64) (link.Link, error) {
	for _, l := range r.links {
		if l.ID == id && l.TenantID == tenantID {
			return l, nil
		}
	}
	return link.Link{}, link.ErrNotFound
}

func (r *countingRepo) ListByTenant(context.Context, int64, page.Params) ([]link.Link, int, error) {
	return nil, 7, nil
}

func (r *countingRepo) Delete(_ context.Context, tenantID, id int64) error {
	for code, l := range r.links {
		if l.ID == id && l.TenantID == tenantID {
			delete(r.links, code)
			return nil
		}
	}
	return link.ErrNotFound
}

func (r *countingRepo) ConsumeClick(context.Context, string) error {
	r.consumes++
	return nil
}

var ctx = context.Background()

func fixture() (*LinkRepository, *countingRepo, *memStore, link.Link) {
	exp := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	max := int64(10)
	l := link.Link{
		ID: 4, Code: "abc1234", OriginURL: "https://example.com/a", ExpiresAt: &exp, MaxClicks: &max,
		ClickCount: 2, TenantID: 1, CreatedBy: 9, CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	next := &countingRepo{links: map[string]link.Link{l.Code: l}}
	store := newMemStore()
	return NewLinkRepository(next, store, time.Minute), next, store, l
}

func TestFindByCodeCachesTheLink(t *testing.T) {
	repo, next, store, want := fixture()

	first, err := repo.FindByCode(ctx, "abc1234")
	require.NoError(t, err)
	assert.Equal(t, want, first)
	assert.Equal(t, 1, next.finds)
	assert.Equal(t, time.Minute, store.ttls["link:code:abc1234"], "entries expire after the configured ttl")

	second, err := repo.FindByCode(ctx, "abc1234")
	require.NoError(t, err)
	assert.Equal(t, want, second, "a cached link comes back whole, with every field")
	assert.Equal(t, 1, next.finds, "the second read does not reach the repository")
}

func TestACachedProtectedLinkStaysProtected(t *testing.T) {
	repo, next, _, _ := fixture()
	l := next.links["abc1234"]
	l.PasswordHash = "$argon2id$v=19$secret"
	next.links["abc1234"] = l

	_, err := repo.FindByCode(ctx, "abc1234") // fills the cache
	require.NoError(t, err)
	got, err := repo.FindByCode(ctx, "abc1234") // served from it
	require.NoError(t, err)
	assert.Equal(t, 1, next.finds)
	assert.True(t, got.Protected(), "the cached copy must not lose the password")
	assert.Equal(t, "$argon2id$v=19$secret", got.PasswordHash)
}

func TestFindByCodeDoesNotCacheMisses(t *testing.T) {
	repo, next, store, _ := fixture()
	_, err := repo.FindByCode(ctx, "nope000")
	assert.ErrorIs(t, err, link.ErrNotFound)
	assert.Empty(t, store.data["link:code:nope000"])

	// A code claimed later must be found at once, not hidden behind a cached "not found".
	next.links["nope000"] = link.Link{ID: 5, Code: "nope000", OriginURL: "https://example.com/new"}
	got, err := repo.FindByCode(ctx, "nope000")
	require.NoError(t, err)
	assert.Equal(t, "https://example.com/new", got.OriginURL)
}

func TestCacheFailuresFallBackToTheRepository(t *testing.T) {
	t.Run("get fails", func(t *testing.T) {
		repo, next, store, want := fixture()
		store.failGet = true
		got, err := repo.FindByCode(ctx, "abc1234")
		require.NoError(t, err)
		assert.Equal(t, want, got)
		assert.Equal(t, 1, next.finds)
	})
	t.Run("set fails", func(t *testing.T) {
		repo, next, store, want := fixture()
		store.failSet = true
		got, err := repo.FindByCode(ctx, "abc1234")
		require.NoError(t, err)
		assert.Equal(t, want, got)
		_, _ = repo.FindByCode(ctx, "abc1234")
		assert.Equal(t, 2, next.finds, "nothing was cached, so both reads hit the repository")
	})
	t.Run("garbage in the cache", func(t *testing.T) {
		repo, next, store, want := fixture()
		store.data["link:code:abc1234"] = []byte("{not json")
		got, err := repo.FindByCode(ctx, "abc1234")
		require.NoError(t, err)
		assert.Equal(t, want, got)
		assert.Equal(t, 1, next.finds)
		again, err := repo.FindByCode(ctx, "abc1234")
		require.NoError(t, err)
		assert.Equal(t, want, again)
		assert.Equal(t, 1, next.finds, "the bad entry was overwritten with a good one")
	})
}

func TestDeleteDropsTheCacheEntry(t *testing.T) {
	repo, next, store, _ := fixture()
	_, err := repo.FindByCode(ctx, "abc1234")
	require.NoError(t, err)
	require.Contains(t, store.data, "link:code:abc1234")

	assert.ErrorIs(t, repo.Delete(ctx, 2, 4), link.ErrNotFound, "another tenant cannot delete it")
	assert.Contains(t, store.data, "link:code:abc1234", "a failed delete keeps the entry")

	require.NoError(t, repo.Delete(ctx, 1, 4))
	assert.Empty(t, store.data, "both keys are gone")
	_, err = repo.FindByCode(ctx, "abc1234")
	assert.ErrorIs(t, err, link.ErrNotFound, "a deleted link stops redirecting")
	assert.Equal(t, 2, next.finds)
}

func TestDeleteSucceedsEvenIfTheCacheCannotBeCleared(t *testing.T) {
	repo, next, store, _ := fixture()
	_, err := repo.FindByCode(ctx, "abc1234")
	require.NoError(t, err)
	store.failDel = true
	require.NoError(t, repo.Delete(ctx, 1, 4))
	assert.NotContains(t, next.links, "abc1234", "the database row is gone")
}

func TestOtherCallsPassThrough(t *testing.T) {
	repo, next, store, _ := fixture()
	require.NoError(t, repo.ConsumeClick(ctx, "abc1234"))
	assert.Equal(t, 1, next.consumes, "ConsumeClick always reaches the database, it enforces max_clicks")

	_, total, err := repo.ListByTenant(ctx, 1, page.Params{})
	require.NoError(t, err)
	assert.Equal(t, 7, total)

	_, err = repo.Create(ctx, link.Link{ID: 8, Code: "new0000", OriginURL: "https://example.com/n"})
	require.NoError(t, err)
	assert.Contains(t, next.links, "new0000")
	assert.Empty(t, store.data, "nothing is cached until the first redirect")
}
