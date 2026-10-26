package link

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/google/uuid"
)

const maxRetries = 5

type Service struct {
	repo Repository
	gen  CodeGenerator
	now  func() time.Time
}

func NewService(repo Repository, gen CodeGenerator) *Service {
	return &Service{
		repo: repo,
		gen:  gen,
		now:  time.Now().UTC,
	}
}

func (s *Service) Shorten(ctx context.Context, rawURL string, expiresAt *time.Time) (Link, error) {
	u, err := url.ParseRequestURI(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return Link{}, ErrInvalidURL
	}
	for range maxRetries {
		code, err := s.gen.Generate()
		if err != nil {
			return Link{}, err
		}
		l := Link{
			ID:        uuid.NewString(),
			Code:      code,
			OriginURL: rawURL,
			CreatedAt: s.now(),
			UpdatedAt: s.now(),
			ExpiresAt: expiresAt,
		}
		err = s.repo.Create(ctx, l)
		if errors.Is(err, ErrCodeTaken) {
			continue
		}
		return l, err
	}
	return Link{}, ErrCodeTaken
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
