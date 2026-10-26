package analytics

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

const (
	maxReferrerLen  = 255
	maxUserAgentLen = 512
	writeTimeout    = 5 * time.Second
)

// Recorder stores clicks in the background so a redirect never waits for the database: Record
// puts the click in a buffered channel and one worker writes them. SQLite has a single writer,
// so more workers would only queue behind each other.
//
// Analytics are best effort. If the buffer is full the click is dropped and counted rather than
// slowing the redirect down, and a failed write is logged. Call Close on shutdown to flush.
type Recorder struct {
	repo    Repository
	now     func() time.Time
	clicks  chan Click
	done    chan struct{}
	dropped atomic.Int64

	mu     sync.RWMutex // guards closed and the close of clicks
	closed bool
}

func NewRecorder(repo Repository, buffer int) *Recorder {
	r := &Recorder{
		repo:   repo,
		now:    func() time.Time { return time.Now().UTC() },
		clicks: make(chan Click, buffer),
		done:   make(chan struct{}),
	}
	go r.run()
	return r
}

// Record queues a click and returns at once; it never blocks and never fails.
func (r *Recorder) Record(c Click) {
	if c.At.IsZero() {
		c.At = r.now()
	}
	c.At = c.At.UTC()
	c.Referrer = truncate(c.Referrer, maxReferrerLen)
	c.UserAgent = truncate(c.UserAgent, maxUserAgentLen)

	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.closed {
		r.dropped.Add(1)
		return
	}
	select {
	case r.clicks <- c:
	default:
		if n := r.dropped.Add(1); n == 1 || n%1000 == 0 {
			slog.Warn("click buffer full, dropping clicks", "dropped_total", n)
		}
	}
}

// Dropped is how many clicks were discarded because the buffer was full or already closed.
func (r *Recorder) Dropped() int64 { return r.dropped.Load() }

func (r *Recorder) run() {
	defer close(r.done)
	for c := range r.clicks {
		ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
		if _, err := r.repo.Create(ctx, c); err != nil {
			slog.Warn("click not recorded", "link_id", c.LinkID, "error", err)
		}
		cancel()
	}
}

// Close stops accepting clicks and waits until the queued ones are written or ctx ends. It is
// safe to call more than once; clicks recorded after it are dropped.
func (r *Recorder) Close(ctx context.Context) error {
	r.mu.Lock()
	if !r.closed {
		r.closed = true
		close(r.clicks)
	}
	r.mu.Unlock()
	select {
	case <-r.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// truncate cuts s to at most max bytes without splitting a character.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	s = s[:max]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
