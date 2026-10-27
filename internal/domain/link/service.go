package link

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
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

// ShortenInput is what a caller can set when creating a link. Alias, ExpiresAt and MaxClicks
// are optional: empty or nil means "generate a code", "never expires" and "unlimited".
type ShortenInput struct {
	TenantID  int64
	UserID    int64
	URL       string
	Alias     string
	ExpiresAt *time.Time
	MaxClicks *int64
}

// Shorten creates a link owned by in.TenantID on behalf of in.UserID.
func (s *Service) Shorten(ctx context.Context, in ShortenInput) (Link, error) {
	u, err := url.ParseRequestURI(in.URL)
	if len(in.URL) > maxURLLen || err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return Link{}, ErrInvalidURL
	}
	expiresAt := utc(in.ExpiresAt)
	if expiresAt != nil && !expiresAt.After(s.now()) {
		return Link{}, ErrInvalidExpiry
	}
	if in.MaxClicks != nil && *in.MaxClicks <= 0 {
		return Link{}, ErrInvalidMaxClicks
	}
	link := Link{
		OriginURL: in.URL,
		ExpiresAt: expiresAt,
		MaxClicks: in.MaxClicks,
		TenantID:  in.TenantID,
		CreatedBy: in.UserID,
		CreatedAt: s.now(),
	}
	if alias := in.Alias; alias != "" {
		if err := validateAlias(alias); err != nil {
			return Link{}, err
		}
		link.Code = alias
		l, err := s.repo.Create(ctx, link)
		if errors.Is(err, ErrCodeTaken) {
			return Link{}, ErrAliasTaken
		}
		return l, err
	}
	for range maxRetries {
		code, err := s.gen.Generate()
		if err != nil {
			return Link{}, err
		}
		link.Code = code
		l, err := s.repo.Create(ctx, link)
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

// List returns one page of the tenant's links, newest first, and how many it has in total.
func (s *Service) List(ctx context.Context, tenantID int64, p page.Params) ([]Link, int, error) {
	return s.repo.ListByTenant(ctx, tenantID, p.Normalize())
}

// Get returns one link of the tenant; a link of another tenant is ErrNotFound.
func (s *Service) Get(ctx context.Context, tenantID, id int64) (Link, error) {
	return s.repo.FindByID(ctx, tenantID, id)
}

// Delete removes a link of the tenant; a link of another tenant is ErrNotFound.
func (s *Service) Delete(ctx context.Context, tenantID, id int64) error {
	return s.repo.Delete(ctx, tenantID, id)
}

// Resolve returns the link a code points to, ready to redirect to l.OriginURL. It counts the
// visit against max_clicks, so call it once per redirect.
func (s *Service) Resolve(ctx context.Context, code string) (Link, error) {
	l, err := s.repo.FindByCode(ctx, code)
	if err != nil {
		return Link{}, err
	}
	if l.IsExpired(s.now()) {
		return Link{}, ErrExpired
	}
	if l.MaxClicks != nil {
		if err := s.repo.ConsumeClick(ctx, code); err != nil {
			return Link{}, err
		}
	}
	return l, nil
}
