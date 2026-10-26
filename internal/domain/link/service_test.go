package link

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	links     map[string]Link
	createErr error
	calls     int
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
		l, err := s.Shorten(ctx, 3, 7, "https://example.com/a?b=1", nil)
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
			_, err := s.Shorten(ctx, 1, 1, raw, nil)
			assert.ErrorIs(t, err, ErrInvalidURL, raw)
		}
	})

	t.Run("retries on collision", func(t *testing.T) {
		repo := newFakeRepo()
		repo.links["dup0000"] = Link{Code: "dup0000"}
		s := newSvc(repo, &fakeGen{codes: []string{"dup0000", "dup0000", "new1111"}})
		l, err := s.Shorten(ctx, 1, 1, "https://example.com", nil)
		require.NoError(t, err)
		assert.Equal(t, "new1111", l.Code)
	})

	t.Run("gives up after max retries", func(t *testing.T) {
		repo := newFakeRepo()
		repo.createErr = ErrCodeTaken
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		_, err := s.Shorten(ctx, 1, 1, "https://example.com", nil)
		assert.ErrorIs(t, err, ErrCodeTaken)
		assert.Equal(t, maxRetries, repo.calls)
	})

	t.Run("propagates generator error", func(t *testing.T) {
		boom := errors.New("boom")
		s := newSvc(newFakeRepo(), &fakeGen{err: boom})
		_, err := s.Shorten(ctx, 1, 1, "https://example.com", nil)
		assert.ErrorIs(t, err, boom)
	})

	t.Run("propagates repository error without retry", func(t *testing.T) {
		boom := errors.New("db down")
		repo := newFakeRepo()
		repo.createErr = boom
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		_, err := s.Shorten(ctx, 1, 1, "https://example.com", nil)
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
			assert.Equal(t, tt.want, got)
		})
	}
}
