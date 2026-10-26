package link

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeRepo struct {
	links     map[string]Link
	createErr error
	calls     int
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		links: make(map[string]Link),
	}
}

func (r *fakeRepo) Create(_ context.Context, l Link) error {
	r.calls++
	if r.createErr != nil {
		return r.createErr
	}
	if _, ok := r.links[l.Code]; ok {
		return ErrCodeTaken
	}
	r.links[l.Code] = l
	return nil
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
	t.Run("stores link with generate code", func(t *testing.T) {
		repo := newFakeRepo()
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		l, err := s.Shorten(ctx, "https://example.com/a?b=1", nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if l.Code != "abc1234" || l.OriginURL != "https://example.com/a?b=1" || l.ID == "" {
			t.Fatalf("unexpected link: %+v", l)
		}
		if _, ok := repo.links["abc1234"]; !ok {
			t.Fatalf("link not stored")
		}
	})
	invalid := []string{
		"",
		"not a URL",
		"ftp://example.com",
		"javascript:alert(1)",
		"https://",
	}
	for _, raw := range invalid {
		t.Run("reects "+raw, func(t *testing.T) {
			s := newSvc(newFakeRepo(), &fakeGen{
				codes: []string{"abc1234"},
			})
			if _, err := s.Shorten(ctx, raw, nil); !errors.Is(err, ErrInvalidURL) {
				t.Fatalf("want ErrInvalidURL, got %v", err)
			}
		})
	}

	t.Run("retries on collision", func(t *testing.T) {
		repo := newFakeRepo()
		repo.links["dup0000"] = Link{Code: "dup0000"}
		s := newSvc(repo, &fakeGen{codes: []string{"dup0000", "dup0000", "new1111"}})
		l, err := s.Shorten(ctx, "https://example.com", nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if l.Code != "new1111" {
			t.Fatalf("want new1111, got %s", l.Code)
		}
	})

	t.Run("gives up after max retries", func(t *testing.T) {
		repo := newFakeRepo()
		repo.createErr = ErrCodeTaken
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		if _, err := s.Shorten(ctx, "https://example.com", nil); !errors.Is(err, ErrCodeTaken) {
			t.Fatalf("want ErrCodeTaken, got %v", err)
		}
		if repo.calls != maxRetries {
			t.Fatalf("want %d attempts, got %d", maxRetries, repo.calls)
		}
	})

	t.Run("propagates generator error", func(t *testing.T) {
		boom := errors.New("boom")
		s := newSvc(newFakeRepo(), &fakeGen{err: boom})
		if _, err := s.Shorten(ctx, "https://example.com", nil); !errors.Is(err, boom) {
			t.Fatalf("want boom, got %v", err)
		}
	})

	t.Run("propagates repository error without retry", func(t *testing.T) {
		boom := errors.New("db down")
		repo := newFakeRepo()
		repo.createErr = boom
		s := newSvc(repo, &fakeGen{codes: []string{"abc1234"}})
		if _, err := s.Shorten(ctx, "https://example.com", nil); !errors.Is(err, boom) {
			t.Fatalf("want db error, got %v", err)
		}
		if repo.calls != 1 {
			t.Fatalf("want 1 attempt, got %d", repo.calls)
		}
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
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("want err %v, got %v", tt.wantErr, err)
			}
			if got != tt.want {
				t.Fatalf("want %q, got %q", tt.want, got)
			}
		})
	}
}
