package link

import (
	"context"
	"errors"
	"net/url"
	"time"
)

const (
	maxRetries = 5
	maxURLLen  = 255 // links.origin_url column limit
)

type Service struct {
	repo Repository
	gen  CodeGenerator
	now  func() time.Time
}

func NewService(repo Repository, gen CodeGenerator) *Service {
	return &Service{
		repo: repo,
		gen:  gen,
		now:  func() time.Time { return time.Now().UTC() },
	}
}

// Shorten creates a link owned by tenantID on behalf of userID.
func (s *Service) Shorten(ctx context.Context, tenantID, userID int64, rawURL string, expiresAt *time.Time) (Link, error) {
	u, err := url.ParseRequestURI(rawURL)
	if len(rawURL) > maxURLLen || err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return Link{}, ErrInvalidURL
	}
	expiresAt = utc(expiresAt)
	for range maxRetries {
		code, err := s.gen.Generate()
		if err != nil {
			return Link{}, err
		}
		l, err := s.repo.Create(ctx, Link{
			Code:      code,
			OriginURL: rawURL,
			ExpiresAt: expiresAt,
			TenantID:  tenantID,
			CreatedBy: userID,
			CreatedAt: s.now(),
		})
		if errors.Is(err, ErrCodeTaken) {
			continue
		}
		return l, err
	}
	return Link{}, ErrCodeTaken
}

// utc returns t in UTC, so every stored and returned instant uses one zone.
func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

func (s *Service) Resolve(ctx context.Context, code string) (string, error) {
	l, err := s.repo.FindByCode(ctx, code)
	if err != nil {
		return "", err
	}
	if l.IsExpired(s.now()) {
		return "", ErrExpired
	}
	return l.OriginURL, nil
}
