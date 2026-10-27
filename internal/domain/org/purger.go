package org

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// PurgeStore is what the Purger needs to delete the rows of organizations that SoftDelete hid.
type PurgeStore interface {
	// PendingDeletion returns up to limit organizations that were soft deleted and still exist.
	PendingDeletion(ctx context.Context, limit int) ([]int64, error)
	// LinkIDs returns up to limit links of the organization.
	LinkIDs(ctx context.Context, tenantID int64, limit int) ([]int64, error)
	// DeleteLinks removes the links (and their clicks and unlock pages) of the organization.
	DeleteLinks(ctx context.Context, tenantID int64, ids []int64) error
	// DeleteOrganization removes a soft deleted organization and whatever still hangs from it.
	DeleteOrganization(ctx context.Context, tenantID int64) error
}

// LinkEvictor drops the cached copies of links, so a deleted link stops redirecting.
type LinkEvictor interface {
	Evict(ctx context.Context, linkIDs []int64) error
}

const (
	purgeBatch    = 200
	purgeOrgs     = 20
	purgeInterval = 30 * time.Second
	purgePause    = 25 * time.Millisecond
)

// Purger deletes soft deleted organizations in the background. Links go in small batches, each
// its own statement, because SQLite has one connection and a single DELETE with a huge cascade
// would hold up every request. State lives in the database (the deleted_at mark), so a failure,
// a crash or a restart only delays the work: the next pass picks it up.
type Purger struct {
	store    PurgeStore
	evict    LinkEvictor
	interval time.Duration
	pause    time.Duration
	kick     chan struct{}
}

func NewPurger(store PurgeStore, evict LinkEvictor) *Purger {
	return &Purger{store: store, evict: evict, interval: purgeInterval, pause: purgePause, kick: make(chan struct{}, 1)}
}

// Kick asks for a pass now. It never blocks and merges with a pass already requested.
func (p *Purger) Kick() {
	select {
	case p.kick <- struct{}{}:
	default:
	}
}

// Run purges once at start (to finish what a previous run left), then on every Kick and every
// interval, until ctx ends. A failed pass is logged and retried on the next one.
func (p *Purger) Run(ctx context.Context) {
	t := time.NewTicker(p.interval)
	defer t.Stop()
	for {
		if err := p.Purge(ctx); err != nil && ctx.Err() == nil {
			slog.Error("purge deleted organizations", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-p.kick:
		case <-t.C:
		}
	}
}

// Purge deletes the pending organizations. A failure in one does not stop the others; the first
// error is returned.
func (p *Purger) Purge(ctx context.Context) error {
	ids, err := p.store.PendingDeletion(ctx, purgeOrgs)
	if err != nil {
		return err
	}
	var first error
	for _, id := range ids {
		if err := p.purgeOrg(ctx, id); err != nil {
			slog.Error("purge organization", "tenant_id", id, "error", err)
			if first == nil {
				first = err
			}
		}
		if ctx.Err() != nil {
			return errors.Join(first, ctx.Err())
		}
	}
	return first
}

func (p *Purger) purgeOrg(ctx context.Context, tenantID int64) error {
	for {
		ids, err := p.store.LinkIDs(ctx, tenantID, purgeBatch)
		if err != nil {
			return fmt.Errorf("list links: %w", err)
		}
		if len(ids) == 0 {
			break
		}
		// Evict first: if deleting fails the links are still there, and so is nothing stale.
		if err := p.evict.Evict(ctx, ids); err != nil {
			return fmt.Errorf("evict links: %w", err)
		}
		if err := p.store.DeleteLinks(ctx, tenantID, ids); err != nil {
			return fmt.Errorf("delete links: %w", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(p.pause):
		}
	}
	if err := p.store.DeleteOrganization(ctx, tenantID); err != nil {
		return fmt.Errorf("delete organization: %w", err)
	}
	return nil
}
