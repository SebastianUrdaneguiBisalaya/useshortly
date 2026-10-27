// Package redis implements link.AttemptLimiter on Redis, so the attempts are shared by every
// instance of the app.
package redis

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// take counts one attempt and returns the new count. The first attempt starts the window; a key
// that somehow has no expiry (a crash between the two commands cannot happen here, but a manual
// edit could) gets one, so a counter can never block someone forever.
var take = goredis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
`)

type Limiter struct {
	client *goredis.Client
}

func NewLimiter(client *goredis.Client) *Limiter {
	return &Limiter{client: client}
}

func attemptsKey(key string) string { return "attempts:" + key }

// Take counts one attempt for key and reports whether it is within limit per window. Counting and
// checking happen in one script, so parallel guesses cannot slip past the limit.
func (l *Limiter) Take(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	n, err := take.Run(ctx, l.client, []string{attemptsKey(key)}, window.Milliseconds()).Int64()
	if err != nil {
		return false, fmt.Errorf("attempt limiter: take: %w", err)
	}
	return n <= int64(limit), nil
}

func (l *Limiter) Reset(ctx context.Context, key string) error {
	if err := l.client.Del(ctx, attemptsKey(key)).Err(); err != nil {
		return fmt.Errorf("attempt limiter: reset: %w", err)
	}
	return nil
}
