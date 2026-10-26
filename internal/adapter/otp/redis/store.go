// Package redis implements user.ResetCodeStore on Redis.
package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	goredis "github.com/redis/go-redis/v9"
)

// check runs atomically inside Redis, so concurrent guesses cannot exceed the attempt
// limit. Results: 0 no code (missing or expired), 1 match, 2 wrong, 3 wrong and exhausted.
// The comparison is between two HMAC values, so its timing reveals nothing usable.
var check = goredis.NewScript(`
local h = redis.call('HGET', KEYS[1], 'h')
if not h then return 0 end
local attempts = redis.call('HINCRBY', KEYS[1], 'a', 1)
if h == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return 3
end
return 2
`)

type Store struct {
	client *goredis.Client
}

func NewStore(client *goredis.Client) *Store {
	return &Store{client: client}
}

func codeKey(email string) string     { return "pwreset:code:" + email }
func cooldownKey(email string) string { return "pwreset:cooldown:" + email }

func (s *Store) Put(ctx context.Context, email, codeHash string, ttl, cooldown time.Duration) error {
	ok, err := s.client.SetNX(ctx, cooldownKey(email), 1, cooldown).Result()
	if err != nil {
		return fmt.Errorf("otp store: cooldown: %w", err)
	}
	if !ok {
		return user.ErrResetTooSoon
	}
	pipe := s.client.TxPipeline()
	pipe.Del(ctx, codeKey(email))
	pipe.HSet(ctx, codeKey(email), "h", codeHash, "a", 0)
	pipe.Expire(ctx, codeKey(email), ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		s.client.Del(ctx, cooldownKey(email)) // do not lock the user out of retrying
		return fmt.Errorf("otp store: put: %w", err)
	}
	return nil
}

func (s *Store) Check(ctx context.Context, email, codeHash string, maxAttempts int) error {
	res, err := check.Run(ctx, s.client, []string{codeKey(email)}, codeHash, maxAttempts).Int()
	if err != nil {
		return fmt.Errorf("otp store: check: %w", err)
	}
	switch res {
	case 1:
		return nil
	case 3:
		return user.ErrTooManyAttempts
	default:
		return user.ErrInvalidResetCode
	}
}
