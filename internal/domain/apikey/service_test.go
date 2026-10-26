package apikey

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

type fakeRepo struct {
	keys    map[int64]APIKey
	nextID  int64
	touched map[int64]time.Time
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{keys: map[int64]APIKey{}, touched: map[int64]time.Time{}}
}

func (r *fakeRepo) Create(_ context.Context, k APIKey) (APIKey, error) {
	r.nextID++
	k.ID = r.nextID
	r.keys[k.ID] = k
	return k, nil
}

func (r *fakeRepo) ListByTenant(_ context.Context, tenantID int64, p page.Params) ([]APIKey, int, error) {
	var all []APIKey
	for id := r.nextID; id >= 1; id-- {
		if k, ok := r.keys[id]; ok && k.TenantID == tenantID {
			all = append(all, k)
		}
	}
	lo := min(p.Offset, len(all))
	hi := min(lo+p.Limit, len(all))
	return all[lo:hi], len(all), nil
}

func (r *fakeRepo) Delete(_ context.Context, tenantID, id int64) error {
	if k, ok := r.keys[id]; ok && k.TenantID == tenantID {
		delete(r.keys, id)
		return nil
	}
	return ErrNotFound
}

func (r *fakeRepo) FindByHash(_ context.Context, hash string) (APIKey, error) {
	for _, k := range r.keys {
		if k.KeyHash == hash {
			return k, nil
		}
	}
	return APIKey{}, ErrNotFound
}

func (r *fakeRepo) TouchLastUsed(_ context.Context, id int64, at time.Time) error {
	r.touched[id] = at
	return nil
}

func TestCreateStoresOnlyHash(t *testing.T) {
	svc := NewService(newFakeRepo())
	k, secret, err := svc.Create(context.Background(), 1, 7, " ci ", ScopeWrite, nil)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(secret, "usl_"))
	assert.Equal(t, "ci", k.Name)
	assert.EqualValues(t, 1, k.TenantID)
	assert.EqualValues(t, 7, k.CreatedBy)
	assert.Equal(t, secret[:12], k.Prefix)
	assert.NotContains(t, k.KeyHash, secret)
	assert.Len(t, k.KeyHash, 64)
}

func TestCreateValidation(t *testing.T) {
	svc := NewService(newFakeRepo())
	past := time.Now().Add(-time.Hour)
	_, _, err := svc.Create(context.Background(), 1, 1, "  ", ScopeWrite, nil)
	assert.ErrorIs(t, err, ErrInvalidName)
	_, _, err = svc.Create(context.Background(), 1, 1, strings.Repeat("a", 101), ScopeWrite, nil)
	assert.ErrorIs(t, err, ErrInvalidName)
	_, _, err = svc.Create(context.Background(), 1, 1, "x", ScopeWrite, &past)
	assert.ErrorIs(t, err, ErrInvalidExpiry)
}

func TestSecretsAreUnique(t *testing.T) {
	svc := NewService(newFakeRepo())
	_, a, err := svc.Create(context.Background(), 1, 1, "a", ScopeWrite, nil)
	require.NoError(t, err)
	_, b, err := svc.Create(context.Background(), 1, 1, "b", ScopeWrite, nil)
	require.NoError(t, err)
	assert.NotEqual(t, a, b)
}

func TestAuthenticate(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	k, secret, err := svc.Create(context.Background(), 1, 7, "ci", ScopeWrite, nil)
	require.NoError(t, err)

	got, err := svc.Authenticate(context.Background(), secret)
	require.NoError(t, err)
	assert.Equal(t, k.ID, got.ID)
	assert.EqualValues(t, 1, got.TenantID)
	assert.False(t, repo.touched[k.ID].IsZero(), "last used not recorded")

	for _, bad := range []string{"", "usl_wrong", "other_" + secret[4:]} {
		_, err := svc.Authenticate(context.Background(), bad)
		assert.ErrorIs(t, err, ErrNotFound, bad)
	}
}

func TestAuthenticateExpired(t *testing.T) {
	svc := NewService(newFakeRepo())
	soon := time.Now().Add(time.Minute)
	_, secret, err := svc.Create(context.Background(), 1, 1, "tmp", ScopeWrite, &soon)
	require.NoError(t, err)
	svc.now = func() time.Time { return time.Now().Add(time.Hour) }
	_, err = svc.Authenticate(context.Background(), secret)
	assert.ErrorIs(t, err, ErrExpired)
}

func TestDeleteIsScopedToTenant(t *testing.T) {
	svc := NewService(newFakeRepo())
	k, _, err := svc.Create(context.Background(), 1, 1, "a", ScopeWrite, nil)
	require.NoError(t, err)
	assert.ErrorIs(t, svc.Delete(context.Background(), 2, k.ID), ErrNotFound)
	require.NoError(t, svc.Delete(context.Background(), 1, k.ID))
	list, total, err := svc.List(context.Background(), 1, page.Params{})
	require.NoError(t, err)
	assert.Empty(t, list)
	assert.Zero(t, total)
}

func TestListPaginatesNewestFirst(t *testing.T) {
	ctx := context.Background()
	svc := NewService(newFakeRepo())
	for _, name := range []string{"a", "b", "c"} {
		_, _, err := svc.Create(ctx, 1, 1, name, ScopeRead, nil)
		require.NoError(t, err)
	}
	_, _, err := svc.Create(ctx, 2, 1, "other", ScopeRead, nil)
	require.NoError(t, err)

	list, total, err := svc.List(ctx, 1, page.Params{Limit: 2})
	require.NoError(t, err)
	assert.Equal(t, 3, total, "total counts only the tenant's keys")
	require.Len(t, list, 2)
	assert.Equal(t, "c", list[0].Name)
	assert.Equal(t, "b", list[1].Name)

	list, _, err = svc.List(ctx, 1, page.Params{Limit: 2, Offset: 2})
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "a", list[0].Name)

	list, total, err = svc.List(ctx, 1, page.Params{Limit: 2, Offset: 10})
	require.NoError(t, err)
	assert.Empty(t, list)
	assert.Equal(t, 3, total)
}

// Regression: `now: time.Now().UTC` froze the clock at construction time.
func TestClockAdvancesAndIsUTC(t *testing.T) {
	s := NewService(nil)
	a := s.now()
	time.Sleep(5 * time.Millisecond)
	b := s.now()
	assert.True(t, b.After(a), "the clock must keep moving")
	assert.Equal(t, time.UTC, a.Location())
}

func TestCreateRequiresAValidScope(t *testing.T) {
	svc := NewService(newFakeRepo())
	for _, bad := range []Scope{"", "admin", "READ", "read write"} {
		_, _, err := svc.Create(context.Background(), 1, 1, "ci", bad, nil)
		assert.ErrorIs(t, err, ErrInvalidScope, string(bad))
	}
	for _, good := range []Scope{ScopeRead, ScopeWrite} {
		k, _, err := svc.Create(context.Background(), 1, 1, "ci", good, nil)
		require.NoError(t, err)
		assert.Equal(t, good, k.Scope)
	}
}

func TestScopeAllows(t *testing.T) {
	assert.True(t, ScopeRead.Allows(ScopeRead))
	assert.False(t, ScopeRead.Allows(ScopeWrite), "a read key cannot write")
	assert.True(t, ScopeWrite.Allows(ScopeRead), "write includes read")
	assert.True(t, ScopeWrite.Allows(ScopeWrite))
	assert.False(t, Scope("").Allows(ScopeRead), "an unknown scope allows nothing")
	assert.False(t, Scope("admin").Allows(ScopeRead))
}

func TestAuthenticateReturnsTheScope(t *testing.T) {
	svc := NewService(newFakeRepo())
	_, secret, err := svc.Create(context.Background(), 1, 7, "ro", ScopeRead, nil)
	require.NoError(t, err)
	k, err := svc.Authenticate(context.Background(), secret)
	require.NoError(t, err)
	assert.Equal(t, ScopeRead, k.Scope)
}
