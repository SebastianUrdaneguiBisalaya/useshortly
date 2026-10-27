// Package cached decorates a link.Repository with a cache in front of FindByCode, the read every
// redirect does. Everything else goes straight to the wrapped repository.
package cached

import (
	"context"
	"encoding/json"
	"log/slog"
	"strconv"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

// Store is the key/value cache the decorator needs; Redis implements it in platform/cache.
type Store interface {
	// Get reports found=false on a miss; an error means the cache itself failed.
	Get(ctx context.Context, key string) (value []byte, found bool, err error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// LinkRepository implements link.Repository. The cache is an optimization, never a dependency:
// if it fails, the request is answered from the wrapped repository and the failure is logged.
//
// Only FindByCode is cached. ConsumeClick always reaches the database, and it is what enforces
// max_clicks, so a cached click_count may be stale but can never let a link exceed its limit
// (the count only grows, so a stale one is never higher than the real one).
type LinkRepository struct {
	next  link.Repository
	store Store
	ttl   time.Duration
}

func NewLinkRepository(next link.Repository, store Store, ttl time.Duration) *LinkRepository {
	return &LinkRepository{next: next, store: store, ttl: ttl}
}

// scope names a code inside its domain: the code alone on the default host, "<domain id>:<code>"
// on a custom domain (codes never contain ':'), so the same code on two domains never collides.
func scope(domainID *int64, code string) string {
	if domainID == nil {
		return code
	}
	return strconv.FormatInt(*domainID, 10) + ":" + code
}

func codeKey(scope string) string { return "link:code:" + scope }

// idKey maps a link id to its scope, so Delete (which only knows the id) can find the entry.
func idKey(id int64) string { return "link:id:" + strconv.FormatInt(id, 10) }

func (r *LinkRepository) FindByCode(ctx context.Context, domainID *int64, code string) (link.Link, error) {
	sc := scope(domainID, code)
	raw, found, err := r.store.Get(ctx, codeKey(sc))
	if err != nil {
		slog.Warn("link cache: get", "code", code, "error", err)
	}
	if found {
		var c cachedLink
		if err := json.Unmarshal(raw, &c); err == nil {
			return c.link(), nil
		}
		slog.Warn("link cache: undecodable entry, reading the database", "code", code)
	}

	l, err := r.next.FindByCode(ctx, domainID, code)
	if err != nil {
		return link.Link{}, err
	}
	r.fill(ctx, l)
	return l, nil
}

func (r *LinkRepository) fill(ctx context.Context, l link.Link) {
	raw, err := json.Marshal(newCachedLink(l))
	if err != nil {
		slog.Warn("link cache: encode", "code", l.Code, "error", err)
		return
	}
	sc := scope(l.DomainID, l.Code)
	if err := r.store.Set(ctx, codeKey(sc), raw, r.ttl); err != nil {
		slog.Warn("link cache: set", "code", l.Code, "error", err)
		return
	}
	if err := r.store.Set(ctx, idKey(l.ID), []byte(sc), r.ttl); err != nil {
		slog.Warn("link cache: set", "code", l.Code, "error", err)
	}
}

// Delete removes the link and then its cache entry. If the cache cannot be cleared the deleted
// link keeps redirecting until its entry expires after ttl.
func (r *LinkRepository) Delete(ctx context.Context, tenantID, id int64) error {
	if err := r.next.Delete(ctx, tenantID, id); err != nil {
		return err
	}
	sc, found, err := r.store.Get(ctx, idKey(id))
	if err != nil {
		slog.Warn("link cache: stale entry after delete", "link_id", id, "error", err)
		return nil
	}
	if !found {
		return nil
	}
	if err := r.store.Del(ctx, codeKey(string(sc)), idKey(id)); err != nil {
		slog.Warn("link cache: stale entry after delete", "link_id", id, "error", err)
	}
	return nil
}

// Evict drops the cached copies of the links, for links that are being deleted without going
// through Delete (an organization purge). Unlike Delete it reports failures, so the caller can retry.
func (r *LinkRepository) Evict(ctx context.Context, ids []int64) error {
	for _, id := range ids {
		sc, found, err := r.store.Get(ctx, idKey(id))
		if err != nil {
			return err
		}
		if !found {
			continue
		}
		if err := r.store.Del(ctx, codeKey(string(sc)), idKey(id)); err != nil {
			return err
		}
	}
	return nil
}

func (r *LinkRepository) Create(ctx context.Context, l link.Link) (link.Link, error) {
	return r.next.Create(ctx, l)
}

func (r *LinkRepository) FindByID(ctx context.Context, tenantID, id int64) (link.Link, error) {
	return r.next.FindByID(ctx, tenantID, id)
}

func (r *LinkRepository) ListByTenant(ctx context.Context, tenantID int64, p page.Params) ([]link.Link, int, error) {
	return r.next.ListByTenant(ctx, tenantID, p)
}

func (r *LinkRepository) ConsumeClick(ctx context.Context, id int64) error {
	return r.next.ConsumeClick(ctx, id)
}

// cachedLink is the stored form of a link. It has its own JSON tags so the domain entity does
// not carry them, and the cache format can change without touching the domain.
type cachedLink struct {
	ID         int64      `json:"id"`
	Code       string     `json:"code"`
	OriginURL  string     `json:"origin_url"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	TenantID   int64      `json:"tenant_id"`
	DomainID   *int64     `json:"domain_id,omitempty"`
	DomainHost string     `json:"domain_host,omitempty"`
	MaxClicks  *int64     `json:"max_clicks,omitempty"`
	ClickCount int64      `json:"click_count"`
	// PasswordHash is cached too: a cached copy that lost it would serve a protected link openly.
	PasswordHash string     `json:"password_hash,omitempty"`
	CreatedBy    int64      `json:"created_by"`
	UpdatedBy    *int64     `json:"updated_by,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    *time.Time `json:"updated_at,omitempty"`
}

func newCachedLink(l link.Link) cachedLink {
	return cachedLink{
		ID: l.ID, Code: l.Code, OriginURL: l.OriginURL, ExpiresAt: l.ExpiresAt, TenantID: l.TenantID,
		DomainID: l.DomainID, DomainHost: l.DomainHost, MaxClicks: l.MaxClicks, ClickCount: l.ClickCount, PasswordHash: l.PasswordHash, CreatedBy: l.CreatedBy,
		UpdatedBy: l.UpdatedBy, CreatedAt: l.CreatedAt, UpdatedAt: l.UpdatedAt,
	}
}

func (c cachedLink) link() link.Link {
	return link.Link{
		ID: c.ID, Code: c.Code, OriginURL: c.OriginURL, ExpiresAt: c.ExpiresAt, TenantID: c.TenantID,
		DomainID: c.DomainID, DomainHost: c.DomainHost, MaxClicks: c.MaxClicks, ClickCount: c.ClickCount, PasswordHash: c.PasswordHash, CreatedBy: c.CreatedBy,
		UpdatedBy: c.UpdatedBy, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}
