// Package unlockpage holds the HTML a visitor sees when a link is protected by a password. An
// organization can set a page for all its links and a more specific one for a single link; without
// either, the application's default page is used.
package unlockpage

import (
	"context"
	"errors"
	"strings"
	"time"
)

// MaxHTMLLen is the largest page, in bytes.
const MaxHTMLLen = 64 << 10

var (
	// ErrNotFound: no page is set there, or the link is not the organization's.
	ErrNotFound    = errors.New("unlockpage: not found")
	ErrInvalidHTML = errors.New("unlockpage: invalid html")
)

// Page is the unlock page of an organization (LinkID nil) or of one of its links.
type Page struct {
	ID        int64
	TenantID  int64
	LinkID    *int64
	HTML      string
	UpdatedAt time.Time
}

type Repository interface {
	// Upsert creates or replaces the page of that scope. Returns ErrNotFound if LinkID is not a
	// link of TenantID.
	Upsert(ctx context.Context, p Page) (Page, error)
	// Get returns the page of exactly that scope (linkID nil: the organization's), or ErrNotFound.
	Get(ctx context.Context, tenantID int64, linkID *int64) (Page, error)
	// Delete removes the page of that scope, or returns ErrNotFound.
	Delete(ctx context.Context, tenantID int64, linkID *int64) error
	// Find returns the page for a link: its own if it has one, else the organization's, else
	// ErrNotFound.
	Find(ctx context.Context, tenantID, linkID int64) (Page, error)
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// Set stores the page of the organization (linkID nil) or of one of its links.
func (s *Service) Set(ctx context.Context, tenantID int64, linkID *int64, html string) (Page, error) {
	if strings.TrimSpace(html) == "" || len(html) > MaxHTMLLen {
		return Page{}, ErrInvalidHTML
	}
	return s.repo.Upsert(ctx, Page{TenantID: tenantID, LinkID: linkID, HTML: html, UpdatedAt: s.now()})
}

func (s *Service) Get(ctx context.Context, tenantID int64, linkID *int64) (Page, error) {
	return s.repo.Get(ctx, tenantID, linkID)
}

func (s *Service) Delete(ctx context.Context, tenantID int64, linkID *int64) error {
	return s.repo.Delete(ctx, tenantID, linkID)
}

// For returns the HTML to show for a link, or ErrNotFound when the caller should use the default.
func (s *Service) For(ctx context.Context, tenantID, linkID int64) (string, error) {
	p, err := s.repo.Find(ctx, tenantID, linkID)
	if err != nil {
		return "", err
	}
	return p.HTML, nil
}
