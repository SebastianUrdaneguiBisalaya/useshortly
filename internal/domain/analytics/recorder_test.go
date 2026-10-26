package analytics

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var fixedNow = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

type fakeRepo struct {
	mu      sync.Mutex
	clicks  []Click
	err     error
	release chan struct{} // when set, Create waits for it
	started chan struct{} // when set, receives once Create is entered
}

func (r *fakeRepo) Create(_ context.Context, c Click) (Click, error) {
	if r.started != nil {
		select {
		case r.started <- struct{}{}:
		default:
		}
	}
	if r.release != nil {
		<-r.release
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return Click{}, r.err
	}
	c.ID = int64(len(r.clicks) + 1)
	r.clicks = append(r.clicks, c)
	return c, nil
}

func (r *fakeRepo) stored() []Click {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Click(nil), r.clicks...)
}

func newRecorder(repo Repository, buffer int) *Recorder {
	r := NewRecorder(repo, buffer)
	r.now = func() time.Time { return fixedNow }
	return r
}

func closeNow(t *testing.T, r *Recorder) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	require.NoError(t, r.Close(ctx))
}

func TestRecordStoresTheClick(t *testing.T) {
	repo := &fakeRepo{}
	r := newRecorder(repo, 8)
	r.Record(Click{LinkID: 3, Referrer: "https://news.example/a", UserAgent: "Mozilla/5.0"})
	closeNow(t, r)

	got := repo.stored()
	require.Len(t, got, 1)
	assert.Equal(t, Click{ID: 1, LinkID: 3, At: fixedNow, Referrer: "https://news.example/a", UserAgent: "Mozilla/5.0"}, got[0])
}

func TestRecordKeepsAGivenTimeInUTC(t *testing.T) {
	repo := &fakeRepo{}
	r := newRecorder(repo, 8)
	at := time.Date(2026, 3, 4, 10, 0, 0, 0, time.FixedZone("UTC+5", 5*3600))
	r.Record(Click{LinkID: 1, At: at})
	closeNow(t, r)
	got := repo.stored()
	require.Len(t, got, 1)
	assert.Equal(t, time.UTC, got[0].At.Location())
	assert.True(t, got[0].At.Equal(at))
}

func TestRecordTruncatesLongHeaders(t *testing.T) {
	repo := &fakeRepo{}
	r := newRecorder(repo, 8)
	// "é" is two bytes: cutting at an odd offset must not leave half a character.
	r.Record(Click{LinkID: 1, Referrer: strings.Repeat("é", 300), UserAgent: strings.Repeat("a", 2000)})
	closeNow(t, r)
	got := repo.stored()
	require.Len(t, got, 1)
	assert.LessOrEqual(t, len(got[0].Referrer), maxReferrerLen)
	assert.True(t, strings.HasPrefix(got[0].Referrer, "éé"))
	assert.Equal(t, strings.Repeat("é", maxReferrerLen/2), got[0].Referrer, "a whole number of characters")
	assert.Len(t, got[0].UserAgent, maxUserAgentLen)
}

func TestCloseFlushesWhatIsQueued(t *testing.T) {
	repo := &fakeRepo{release: make(chan struct{}), started: make(chan struct{}, 1)}
	r := newRecorder(repo, 16)
	for i := 1; i <= 10; i++ {
		r.Record(Click{LinkID: int64(i)})
	}
	<-repo.started // the worker is stuck on the first click, nine are still queued
	close(repo.release)
	closeNow(t, r)
	assert.Len(t, repo.stored(), 10)
	assert.Zero(t, r.Dropped())
}

func TestRecordNeverBlocksAndDropsWhenTheBufferIsFull(t *testing.T) {
	repo := &fakeRepo{release: make(chan struct{}), started: make(chan struct{}, 1)}
	r := newRecorder(repo, 2)
	r.Record(Click{LinkID: 1})
	<-repo.started // the worker holds click 1; the buffer is empty again

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 2; i <= 6; i++ { // 2 fit in the buffer, 3 are dropped
			r.Record(Click{LinkID: int64(i)})
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Record blocked while the database was slow")
	}
	assert.EqualValues(t, 3, r.Dropped())

	close(repo.release)
	closeNow(t, r)
	assert.Len(t, repo.stored(), 3)
}

func TestWriteErrorsDoNotStopTheWorker(t *testing.T) {
	repo := &fakeRepo{err: errors.New("db down")}
	r := newRecorder(repo, 8)
	r.Record(Click{LinkID: 1})
	repo.mu.Lock()
	repo.err = nil
	repo.mu.Unlock()
	// Whether click 1 saw the error or not, the worker must keep going for click 2.
	r.Record(Click{LinkID: 2})
	closeNow(t, r)
	got := repo.stored()
	require.NotEmpty(t, got)
	assert.EqualValues(t, 2, got[len(got)-1].LinkID)
}

func TestRecordAfterCloseIsDroppedNotAPanic(t *testing.T) {
	repo := &fakeRepo{}
	r := newRecorder(repo, 8)
	closeNow(t, r)
	assert.NotPanics(t, func() { r.Record(Click{LinkID: 1}) })
	assert.EqualValues(t, 1, r.Dropped())
	assert.Empty(t, repo.stored())
	closeNow(t, r) // closing twice is fine
}

func TestCloseGivesUpWhenTheContextEnds(t *testing.T) {
	repo := &fakeRepo{release: make(chan struct{}), started: make(chan struct{}, 1)}
	r := newRecorder(repo, 8)
	r.Record(Click{LinkID: 1})
	<-repo.started
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	assert.ErrorIs(t, r.Close(ctx), context.DeadlineExceeded)
	close(repo.release)
}

func TestConcurrentRecordAndCloseDoNotRace(t *testing.T) {
	repo := &fakeRepo{}
	r := newRecorder(repo, 64)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				r.Record(Click{LinkID: 1})
			}
		}()
	}
	closeNow(t, r)
	wg.Wait()
	assert.EqualValues(t, 1600, int64(len(repo.stored()))+r.Dropped(), "every click was either stored or counted as dropped")
}
