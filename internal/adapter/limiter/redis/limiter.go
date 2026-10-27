// Package redis implements link.AttemptLimiter on Redis, so the tries are shared by every
// instance of the app.
package redis

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
)

// take counts one try under an exponential backoff. The key is a hash with n (tries so far) and
// until (the millisecond before which tries are refused). It returns {allowed, retry_ms}: {0, left}
// while waiting, and {1, wait} for a try that may go ahead, where wait is what follows it. The clock
// is Redis's own, so every app instance agrees. The wait after the n-th try is
// min(base * 2^(n-free), max) from the free-th try on, the same as link.Backoff.DelayAfter.
var take = goredis.NewScript(`
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local free, base, max, memory = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local blocked_until = tonumber(redis.call('HGET', KEYS[1], 'until') or '0')
if blocked_until > now then
  return {0, blocked_until - now}
end
local n = redis.call('HINCRBY', KEYS[1], 'n', 1)
local wait = 0
if n >= free then
  local exp = n - free
  if exp > 30 then exp = 30 end
  wait = math.min(base * 2 ^ exp, max)
  redis.call('HSET', KEYS[1], 'until', string.format('%.0f', now + wait))
end
redis.call('PEXPIRE', KEYS[1], memory)
return {1, math.floor(wait)}
`)

type Limiter struct {
	client *goredis.Client
}

func NewLimiter(client *goredis.Client) *Limiter {
	return &Limiter{client: client}
}

func attemptsKey(key string) string { return "attempts:" + key }

func (l *Limiter) Take(ctx context.Context, key string, p link.Backoff) (bool, time.Duration, error) {
	res, err := take.Run(ctx, l.client, []string{attemptsKey(key)},
		p.Free, p.Base.Milliseconds(), p.Max.Milliseconds(), p.Memory.Milliseconds()).Slice()
	if err != nil {
		return false, 0, fmt.Errorf("attempt limiter: take: %w", err)
	}
	allowed, _ := res[0].(int64)
	ms, _ := res[1].(int64)
	return allowed == 1, time.Duration(ms) * time.Millisecond, nil
}

func (l *Limiter) Reset(ctx context.Context, key string) error {
	if err := l.client.Del(ctx, attemptsKey(key)).Err(); err != nil {
		return fmt.Errorf("attempt limiter: reset: %w", err)
	}
	return nil
}
