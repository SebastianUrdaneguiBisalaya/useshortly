package mailing

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

const asyncTimeout = 15 * time.Second

// Mailer is what Async wraps: *Service satisfies it.
type Mailer interface {
	Send(ctx context.Context, code, to string, data map[string]string) error
}

// Async sends in the background so an email can never slow down or fail the request
// that triggered it: errors are logged and Send always returns nil. Call Wait on shutdown
// to let in-flight emails finish.
type Async struct {
	mailer Mailer
	wg     sync.WaitGroup
}

func NewAsync(m Mailer) *Async {
	return &Async{mailer: m}
}

func (a *Async) Send(ctx context.Context, code, to string, data map[string]string) error {
	// The request context is cancelled as soon as the response is written.
	ctx = context.WithoutCancel(ctx)
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		ctx, cancel := context.WithTimeout(ctx, asyncTimeout)
		defer cancel()
		if err := a.mailer.Send(ctx, code, to, data); err != nil {
			slog.Warn("email not sent", "template", code, "error", err)
		}
	}()
	return nil
}

// Wait blocks until every email started by Send has finished (or timed out).
func (a *Async) Wait() {
	a.wg.Wait()
}
