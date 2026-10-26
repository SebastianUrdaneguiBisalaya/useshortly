// Package redis implements user.CodeStore on Redis.
package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	goredis "github.com/redis/go-redis/v9"
)

// check runs atomically inside Redis, so concurrent guesses cannot exceed the attempt
// limit. It returns {status, payload}: 0 no code (missing or expired), 1 match (with the
// stored payload), 2 wrong, 3 wrong and exhausted. The comparison is between two HMAC
// values, so its timing reveals nothing usable.
var check = goredis.NewScript(`
local h = redis.call('HGET', KEYS[1], 'h')
if not h then return {0, ''} end
local attempts = redis.call('HINCRBY', KEYS[1], 'a', 1)
if h == ARGV[1] then
  local p = redis.call('HGET', KEYS[1], 'p') or ''
  redis.call('DEL', KEYS[1])
  return {1, p}
end
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return {3, ''}
end
return {2, ''}
`)

type Store struct {
	client *goredis.Client
}

func NewStore(client *goredis.Client) *Store {
	return &Store{client: client}
}

func codeKey(p user.Purpose, email string) string { return "otp:" + string(p) + ":code:" + email }
func cooldownKey(p user.Purpose, email string) string {
	return "otp:" + string(p) + ":cooldown:" + email
}

func (s *Store) Put(ctx context.Context, purpose user.Purpose, email, codeHash, payload string, ttl, cooldown time.Duration) error {
	ok, err := s.client.SetNX(ctx, cooldownKey(purpose, email), 1, cooldown).Result()
	if err != nil {
		return fmt.Errorf("otp store: cooldown: %w", err)
	}
	if !ok {
		return user.ErrCodeTooSoon
	}
	key := codeKey(purpose, email)
	pipe := s.client.TxPipeline()
	pipe.Del(ctx, key)
	pipe.HSet(ctx, key, "h", codeHash, "a", 0, "p", payload)
	pipe.Expire(ctx, key, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		s.client.Del(ctx, cooldownKey(purpose, email)) // do not lock the user out of retrying
		return fmt.Errorf("otp store: put: %w", err)
	}
	return nil
}

func (s *Store) Check(ctx context.Context, purpose user.Purpose, email, codeHash string, maxAttempts int) (string, error) {
	res, err := check.Run(ctx, s.client, []string{codeKey(purpose, email)}, codeHash, maxAttempts).Slice()
	if err != nil {
		return "", fmt.Errorf("otp store: check: %w", err)
	}
	status, _ := res[0].(int64)
	payload, _ := res[1].(string)
	switch status {
	case 1:
		return payload, nil
	case 3:
		return "", user.ErrTooManyAttempts
	default:
		return "", user.ErrInvalidCode
	}
}
