package unlockpage

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var fixedNow = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

type fakeRepo struct {
	pages map[string]Page // key: tenant/link
	links map[int64]int64 // link id -> tenant id
}

func key(tenantID int64, linkID *int64) string {
	if linkID == nil {
		return string(rune('0'+tenantID)) + "/-"
	}
	return string(rune('0'+tenantID)) + "/" + string(rune('0'+*linkID))
}

func (r *fakeRepo) Upsert(_ context.Context, p Page) (Page, error) {
	if p.LinkID != nil && r.links[*p.LinkID] != p.TenantID {
		return Page{}, ErrNotFound
	}
	r.pages[key(p.TenantID, p.LinkID)] = p
	return p, nil
}

func (r *fakeRepo) Get(_ context.Context, tenantID int64, linkID *int64) (Page, error) {
	p, ok := r.pages[key(tenantID, linkID)]
	if !ok {
		return Page{}, ErrNotFound
	}
	return p, nil
}

func (r *fakeRepo) Delete(_ context.Context, tenantID int64, linkID *int64) error {
	if _, ok := r.pages[key(tenantID, linkID)]; !ok {
		return ErrNotFound
	}
	delete(r.pages, key(tenantID, linkID))
	return nil
}

func (r *fakeRepo) Find(ctx context.Context, tenantID, linkID int64) (Page, error) {
	if p, err := r.Get(ctx, tenantID, &linkID); err == nil {
		return p, nil
	}
	return r.Get(ctx, tenantID, nil)
}

func newService() *Service {
	s := NewService(&fakeRepo{pages: map[string]Page{}, links: map[int64]int64{1: 1, 2: 1, 3: 2}})
	s.now = func() time.Time { return fixedNow }
	return s
}

func i64(n int64) *int64 { return &n }

func TestSetRejectsEmptyAndHugePages(t *testing.T) {
	s := newService()
	for name, html := range map[string]string{"empty": "", "blank": " \n\t", "too big": strings.Repeat("a", MaxHTMLLen+1)} {
		_, err := s.Set(context.Background(), 1, nil, html)
		assert.ErrorIs(t, err, ErrInvalidHTML, name)
	}
	_, err := s.Set(context.Background(), 1, nil, strings.Repeat("a", MaxHTMLLen))
	assert.NoError(t, err, "exactly the maximum")
}

func TestSetStampsTheTimeAndReplaces(t *testing.T) {
	ctx := context.Background()
	s := newService()
	p, err := s.Set(ctx, 1, nil, "<p>v1</p>")
	require.NoError(t, err)
	assert.Equal(t, fixedNow, p.UpdatedAt)
	_, err = s.Set(ctx, 1, nil, "<p>v2</p>")
	require.NoError(t, err)
	got, err := s.Get(ctx, 1, nil)
	require.NoError(t, err)
	assert.Equal(t, "<p>v2</p>", got.HTML)
}

func TestForPicksTheMostSpecificPage(t *testing.T) {
	ctx := context.Background()
	s := newService()

	_, err := s.For(ctx, 1, 1)
	assert.ErrorIs(t, err, ErrNotFound, "no page at all: the caller uses the default")

	_, err = s.Set(ctx, 1, nil, "<p>org</p>")
	require.NoError(t, err)
	html, err := s.For(ctx, 1, 1)
	require.NoError(t, err)
	assert.Equal(t, "<p>org</p>", html, "the organization's page covers its links")

	_, err = s.Set(ctx, 1, i64(1), "<p>link one</p>")
	require.NoError(t, err)
	html, _ = s.For(ctx, 1, 1)
	assert.Equal(t, "<p>link one</p>", html, "a link's own page wins")
	html, _ = s.For(ctx, 1, 2)
	assert.Equal(t, "<p>org</p>", html, "other links keep the organization's page")

	_, err = s.For(ctx, 2, 3)
	assert.ErrorIs(t, err, ErrNotFound, "another organization's pages do not leak")
}

func TestALinkPageNeedsALinkOfTheOrganization(t *testing.T) {
	_, err := newService().Set(context.Background(), 1, i64(3), "<p>x</p>")
	assert.ErrorIs(t, err, ErrNotFound, "link 3 belongs to organization 2")
}

func TestDelete(t *testing.T) {
	ctx := context.Background()
	s := newService()
	_, err := s.Set(ctx, 1, nil, "<p>org</p>")
	require.NoError(t, err)
	require.NoError(t, s.Delete(ctx, 1, nil))
	assert.ErrorIs(t, s.Delete(ctx, 1, nil), ErrNotFound)
	_, err = s.Get(ctx, 1, nil)
	assert.ErrorIs(t, err, ErrNotFound)
}
