package redis

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These tests need a real Redis (they exercise the Lua script): set REDIS_URL, e.g.
//
//	REDIS_URL=redis://localhost:6379 go test ./internal/adapter/otp/...
func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL not set")
	}
	opts, err := goredis.ParseURL(url)
	require.NoError(t, err)
	client := goredis.NewClient(opts)
	t.Cleanup(func() { client.Close() })
	ctx := context.Background()
	require.NoError(t, client.Ping(ctx).Err())
	email := "otp-test-" + t.Name() + "@example.com"
	cleanup := func() { client.Del(ctx, codeKey(email), cooldownKey(email)) }
	cleanup()
	t.Cleanup(cleanup)
	return NewStore(client), email
}

var ctx = context.Background()

func TestPutAndCheckSucceedsOnceOnly(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, email, "hash-1", time.Minute, time.Second))
	assert.NoError(t, s.Check(ctx, email, "hash-1", 3))
	assert.ErrorIs(t, s.Check(ctx, email, "hash-1", 3), user.ErrInvalidResetCode, "single use")
}

func TestCheckWithoutCode(t *testing.T) {
	s, email := newStore(t)
	assert.ErrorIs(t, s.Check(ctx, email, "x", 3), user.ErrInvalidResetCode)
}

func TestThirdWrongAttemptDeletesTheCode(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, email, "hash-1", time.Minute, time.Second))
	assert.ErrorIs(t, s.Check(ctx, email, "bad1", 3), user.ErrInvalidResetCode)
	assert.ErrorIs(t, s.Check(ctx, email, "bad2", 3), user.ErrInvalidResetCode)
	assert.ErrorIs(t, s.Check(ctx, email, "bad3", 3), user.ErrTooManyAttempts)
	assert.ErrorIs(t, s.Check(ctx, email, "hash-1", 3), user.ErrInvalidResetCode, "right code is dead after exhaustion")
}

func TestCorrectCodeOnTheThirdAttemptStillWorks(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, email, "hash-1", time.Minute, time.Second))
	assert.ErrorIs(t, s.Check(ctx, email, "bad1", 3), user.ErrInvalidResetCode)
	assert.ErrorIs(t, s.Check(ctx, email, "bad2", 3), user.ErrInvalidResetCode)
	assert.NoError(t, s.Check(ctx, email, "hash-1", 3))
}

func TestPutHonoursCooldownAndReplacesTheCode(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, email, "hash-1", time.Minute, 300*time.Millisecond))
	assert.ErrorIs(t, s.Put(ctx, email, "hash-2", time.Minute, 300*time.Millisecond), user.ErrResetTooSoon)
	assert.NoError(t, s.Check(ctx, email, "hash-1", 3), "the rejected Put did not replace the code")
}

func TestNewCodeResetsAttemptsAndInvalidatesTheOldOne(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, email, "old", time.Minute, 100*time.Millisecond))
	assert.ErrorIs(t, s.Check(ctx, email, "bad", 3), user.ErrInvalidResetCode)
	assert.ErrorIs(t, s.Check(ctx, email, "bad", 3), user.ErrInvalidResetCode)
	time.Sleep(150 * time.Millisecond)

	require.NoError(t, s.Put(ctx, email, "new", time.Minute, time.Second))
	assert.ErrorIs(t, s.Check(ctx, email, "old", 3), user.ErrInvalidResetCode)
	assert.ErrorIs(t, s.Check(ctx, email, "bad", 3), user.ErrInvalidResetCode)
	assert.NoError(t, s.Check(ctx, email, "new", 3), "attempts started again at zero")
}

func TestCodeExpires(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, email, "hash-1", 200*time.Millisecond, time.Second))
	time.Sleep(300 * time.Millisecond)
	assert.ErrorIs(t, s.Check(ctx, email, "hash-1", 3), user.ErrInvalidResetCode)
}
