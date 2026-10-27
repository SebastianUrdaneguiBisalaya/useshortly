package org

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakePurgeStore struct {
	mu       sync.Mutex // Run works in its own goroutine
	pending  map[int64]bool
	links    map[int64][]int64 // tenant -> link ids
	orgs     map[int64]bool    // organizations still stored
	failOnce error             // returned by the next DeleteLinks
	calls    []string
}

func newFakePurgeStore() *fakePurgeStore {
	return &fakePurgeStore{pending: map[int64]bool{}, links: map[int64][]int64{}, orgs: map[int64]bool{}}
}

func (s *fakePurgeStore) add(tenant int64, links ...int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending[tenant], s.orgs[tenant], s.links[tenant] = true, true, links
}

func (s *fakePurgeStore) PendingDeletion(context.Context, int) ([]int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []int64
	for id := range s.pending {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

func (s *fakePurgeStore) LinkIDs(_ context.Context, tenant int64, limit int) ([]int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := s.links[tenant]
	return ids[:min(limit, len(ids))], nil
}

func (s *fakePurgeStore) DeleteLinks(_ context.Context, tenant int64, ids []int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.failOnce; err != nil {
		s.failOnce = nil
		return err
	}
	s.calls = append(s.calls, "delete-links")
	s.links[tenant] = s.links[tenant][len(ids):]
	return nil
}

func (s *fakePurgeStore) DeleteOrganization(_ context.Context, tenant int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.links[tenant]) > 0 {
		return errors.New("organization still has links")
	}
	delete(s.pending, tenant)
	delete(s.orgs, tenant)
	return nil
}

type fakeEvictor struct {
	evicted [][]int64
	err     error
}

func (e *fakeEvictor) Evict(_ context.Context, ids []int64) error {
	if e.err != nil {
		return e.err
	}
	e.evicted = append(e.evicted, ids)
	return nil
}

func newPurger(s *fakePurgeStore, e *fakeEvictor) *Purger {
	p := NewPurger(s, e)
	p.pause = 0
	return p
}

func TestPurgeDeletesLinksInBatchesThenTheOrganization(t *testing.T) {
	s, e := newFakePurgeStore(), &fakeEvictor{}
	ids := make([]int64, purgeBatch*2+5)
	for i := range ids {
		ids[i] = int64(i + 1)
	}
	s.add(1, ids...)
	s.add(2) // no links at all

	require.NoError(t, newPurger(s, e).Purge(context.Background()))

	assert.Empty(t, s.orgs, "both organizations are gone")
	assert.Len(t, e.evicted, 3, "three batches, each evicted before it is deleted")
	assert.Len(t, e.evicted[0], purgeBatch)
	assert.Len(t, e.evicted[2], 5)
}

func TestPurgeRetriesAfterAFailureWithoutLosingWork(t *testing.T) {
	s, e := newFakePurgeStore(), &fakeEvictor{}
	s.add(1, 1, 2, 3)
	s.add(2, 4)
	s.failOnce = errors.New("database is locked")
	p := newPurger(s, e)

	err := p.Purge(context.Background())
	assert.ErrorContains(t, err, "database is locked")
	assert.True(t, s.orgs[1], "the failed one stays pending")
	assert.False(t, s.orgs[2], "the other organization was still purged")

	require.NoError(t, p.Purge(context.Background()), "the next pass finishes it")
	assert.Empty(t, s.orgs)
}

func TestPurgeDoesNotDeleteWhatItCouldNotEvict(t *testing.T) {
	s, e := newFakePurgeStore(), &fakeEvictor{err: errors.New("redis down")}
	s.add(1, 1, 2)
	p := newPurger(s, e)

	assert.Error(t, p.Purge(context.Background()))
	assert.Empty(t, s.calls, "no link was deleted while its cache entry could not be dropped")
	assert.True(t, s.orgs[1])

	e.err = nil
	require.NoError(t, p.Purge(context.Background()))
	assert.Empty(t, s.orgs)
}

func TestRunPurgesAtStartAndOnKick(t *testing.T) {
	s, e := newFakePurgeStore(), &fakeEvictor{}
	s.add(1, 1)
	p := newPurger(s, e)
	p.interval = time.Hour

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { p.Run(ctx); close(done) }()

	waitFor(t, func() bool { return len(s.PendingDeletionIDs()) == 0 })
	s.add(2, 5, 6)
	p.Kick()
	p.Kick() // merged with the first
	waitFor(t, func() bool { return len(s.PendingDeletionIDs()) == 0 })

	cancel()
	<-done
}

func (s *fakePurgeStore) PendingDeletionIDs() []int64 {
	ids, _ := s.PendingDeletion(context.Background(), 10)
	return ids
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}
