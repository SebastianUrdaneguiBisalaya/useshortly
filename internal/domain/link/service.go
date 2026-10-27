package link

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

const (
	maxRetries = 5
	maxURLLen  = 255 // links.origin_url column limit
)

type Service struct {
	repo    Repository
	gen     CodeGenerator
	hasher  PasswordHasher
	limiter AttemptLimiter
	now     func() time.Time
}

func NewService(repo Repository, gen CodeGenerator, hasher PasswordHasher, limiter AttemptLimiter) *Service {
	return &Service{
		repo:    repo,
		gen:     gen,
		hasher:  hasher,
		limiter: limiter,
		now:     func() time.Time { return time.Now().UTC() },
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
	// Password, if set, protects the link: visitors must unlock it first.
	Password string
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
	var passwordHash string
	if in.Password != "" {
		if !validPassword(in.Password) {
			return Link{}, ErrInvalidPassword
		}
		if passwordHash, err = s.hasher.Hash(in.Password); err != nil {
			return Link{}, err
		}
	}
	link := Link{
		PasswordHash: passwordHash,
		OriginURL:    in.URL,
		ExpiresAt:    expiresAt,
		MaxClicks:    in.MaxClicks,
		TenantID:     in.TenantID,
		CreatedBy:    in.UserID,
		CreatedAt:    s.now(),
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
//
// A protected link is not served: it returns the link with ErrPasswordRequired (so the caller can
// show the right unlock page) and counts nothing. Use Unlock for those.
func (s *Service) Resolve(ctx context.Context, code string) (Link, error) {
	l, err := s.repo.FindByCode(ctx, code)
	if err != nil {
		return Link{}, err
	}
	if l.IsExpired(s.now()) {
		return Link{}, ErrExpired
	}
	if l.Protected() {
		return l, ErrPasswordRequired
	}
	return s.visit(ctx, l)
}

// Unlock checks the password of a protected link and, if right, counts the visit like Resolve.
// visitor identifies who is trying (their address). Each visitor gets 3 free tries per link; after
// that every try is followed by a wait that doubles from 30 seconds up to an hour, and a try made
// during it fails with ErrTooManyAttempts (see RetryAfter) without looking at the password. A link
// that is not protected is simply served.
func (s *Service) Unlock(ctx context.Context, code, password, visitor string) (Link, error) {
	l, err := s.repo.FindByCode(ctx, code)
	if err != nil {
		return Link{}, err
	}
	if l.IsExpired(s.now()) {
		return Link{}, ErrExpired
	}
	if !l.Protected() {
		return s.visit(ctx, l)
	}
	key := "unlock:" + code + ":" + visitor
	allowed, retryAfter, err := s.limiter.Take(ctx, key, unlockBackoff)
	if err != nil {
		return Link{}, err
	}
	if !allowed {
		return l, &TooManyAttemptsError{RetryAfter: retryAfter}
	}
	ok, err := s.hasher.Verify(l.PasswordHash, password)
	if err != nil {
		return Link{}, err
	}
	if !ok {
		return l, ErrWrongPassword
	}
	if err := s.limiter.Reset(ctx, key); err != nil {
		slog.Warn("link: unlock attempts not cleared", "code", code, "error", err)
	}
	return s.visit(ctx, l)
}

// visit counts the click against max_clicks and returns the link to redirect to.
func (s *Service) visit(ctx context.Context, l Link) (Link, error) {
	if l.MaxClicks != nil {
		if err := s.repo.ConsumeClick(ctx, l.Code); err != nil {
			return Link{}, err
		}
	}
	return l, nil
}
