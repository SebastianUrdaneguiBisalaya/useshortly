package link

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"strconv"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

const (
	maxRetries = 5
	maxURLLen  = 255 // links.origin_url column limit
)

type Service struct {
	repo     Repository
	gen      CodeGenerator
	hasher   PasswordHasher
	limiter  AttemptLimiter
	domains  DomainChecker
	channels ChannelResolver
	now      func() time.Time
}

// DomainChecker says whether a tenant may serve links from a custom domain.
type DomainChecker interface {
	// RequireVerified returns an error unless the tenant owns the domain and it is verified.
	RequireVerified(ctx context.Context, tenantID, domainID int64) error
}

// WithDomains enables links on custom domains; without it ShortenInput.DomainID is refused.
func (s *Service) WithDomains(d DomainChecker) *Service {
	s.domains = d
	return s
}

// ChannelResolver names the campaign and the channel of a link for its UTM parameters.
type ChannelResolver interface {
	// Resolve returns the names of the tenant's channel and of its campaign, or an error if the
	// tenant has no such channel.
	Resolve(ctx context.Context, tenantID, channelID int64) (campaignName, channelName string, err error)
}

// WithChannels enables links in campaign channels; without it ShortenInput.ChannelID is refused.
func (s *Service) WithChannels(c ChannelResolver) *Service {
	s.channels = c
	return s
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
	TenantID int64
	UserID   int64
	URL      string
	// DomainID serves the link from one of the tenant's verified custom domains; nil is the default host.
	DomainID *int64
	// ChannelID shares the link in a channel of one of the tenant's campaigns: the destination gets
	// the utm_source, utm_medium and utm_campaign parameters of the channel. nil is no campaign.
	ChannelID *int64
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
	if in.DomainID != nil {
		if s.domains == nil {
			return Link{}, ErrDomainsDisabled
		}
		if err := s.domains.RequireVerified(ctx, in.TenantID, *in.DomainID); err != nil {
			return Link{}, err
		}
	}
	originURL := in.URL
	if in.ChannelID != nil {
		if originURL, err = s.tagged(ctx, in.TenantID, *in.ChannelID, in.URL); err != nil {
			return Link{}, err
		}
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
		OriginURL:    originURL,
		ExpiresAt:    expiresAt,
		MaxClicks:    in.MaxClicks,
		TenantID:     in.TenantID,
		DomainID:     in.DomainID,
		ChannelID:    in.ChannelID,
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

// tagged returns rawURL with the UTM parameters of the tenant's channel.
func (s *Service) tagged(ctx context.Context, tenantID, channelID int64, rawURL string) (string, error) {
	if s.channels == nil {
		return "", ErrCampaignsDisabled
	}
	campaign, channel, err := s.channels.Resolve(ctx, tenantID, channelID)
	if err != nil {
		return "", err
	}
	tagged := withUTM(rawURL, campaign, channel)
	if len(tagged) > maxURLLen {
		return "", ErrCampaignURLTooLong
	}
	return tagged, nil
}

// SetChannel puts a link of the tenant in a channel, tagging its destination with the channel's UTM
// parameters, or takes it out of its campaign with a nil channelID, which removes utm_source,
// utm_medium and utm_campaign from the destination (a utm_* value the link had before it joined
// the campaign is not restored). A link of another tenant is ErrNotFound.
func (s *Service) SetChannel(ctx context.Context, tenantID, userID, id int64, channelID *int64) (Link, error) {
	l, err := s.repo.FindByID(ctx, tenantID, id)
	if err != nil {
		return Link{}, err
	}
	originURL := l.OriginURL
	if channelID != nil {
		if originURL, err = s.tagged(ctx, tenantID, *channelID, originURL); err != nil {
			return Link{}, err
		}
	} else if l.ChannelID != nil {
		originURL = withoutUTM(originURL)
	}
	if err := s.repo.SetChannel(ctx, tenantID, id, channelID, originURL, userID, s.now()); err != nil {
		return Link{}, err
	}
	return s.repo.FindByID(ctx, tenantID, id)
}

// utc returns t in UTC, so every stored and returned instant uses one zone.
func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// List returns one page of the tenant's links that pass the filter, newest first, and how many pass it.
func (s *Service) List(ctx context.Context, tenantID int64, f ListFilter, p page.Params) ([]Link, int, error) {
	return s.repo.ListByTenant(ctx, tenantID, f, p.Normalize())
}

// Get returns one link of the tenant; a link of another tenant is ErrNotFound.
func (s *Service) Get(ctx context.Context, tenantID, id int64) (Link, error) {
	return s.repo.FindByID(ctx, tenantID, id)
}

// Delete removes a link of the tenant; a link of another tenant is ErrNotFound.
func (s *Service) Delete(ctx context.Context, tenantID, id int64) error {
	return s.repo.Delete(ctx, tenantID, id)
}

// Resolve returns the link a code points to in the domain (nil is the default
// host), ready to redirect to l.OriginURL. It counts the visit against max_clicks, so call it once
// per redirect.
//
// A protected link is not served: it returns the link with ErrPasswordRequired (so the caller can
// show the right unlock page) and counts nothing. Use Unlock for those.
func (s *Service) Resolve(ctx context.Context, domainID *int64, code string) (Link, error) {
	l, err := s.repo.FindByCode(ctx, domainID, code)
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
func (s *Service) Unlock(ctx context.Context, domainID *int64, code, password, visitor string) (Link, error) {
	l, err := s.repo.FindByCode(ctx, domainID, code)
	if err != nil {
		return Link{}, err
	}
	if l.IsExpired(s.now()) {
		return Link{}, ErrExpired
	}
	if !l.Protected() {
		return s.visit(ctx, l)
	}
	scope := code
	if domainID != nil {
		scope = strconv.FormatInt(*domainID, 10) + "/" + code // the same code on another domain is another link
	}
	key := "unlock:" + scope + ":" + visitor
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
		if err := s.repo.ConsumeClick(ctx, l.ID); err != nil {
			return Link{}, err
		}
	}
	return l, nil
}
