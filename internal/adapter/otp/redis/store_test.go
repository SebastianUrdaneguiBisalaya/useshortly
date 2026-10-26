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
	cleanup := func() {
		for _, p := range []user.Purpose{user.PurposeReset, user.PurposeSignup} {
			client.Del(ctx, codeKey(p, email), cooldownKey(p, email))
		}
	}
	cleanup()
	t.Cleanup(cleanup)
	return NewStore(client), email
}

var ctx = context.Background()

const reset = user.PurposeReset

func TestPutAndCheckSucceedsOnceOnly(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, reset, email, "hash-1", "", time.Minute, time.Second))
	_, err := s.Check(ctx, reset, email, "hash-1", 3)
	assert.NoError(t, err)
	_, err = s.Check(ctx, reset, email, "hash-1", 3)
	assert.ErrorIs(t, err, user.ErrInvalidCode, "single use")
}

func TestCheckReturnsThePayload(t *testing.T) {
	s, email := newStore(t)
	payload := `{"first_name":"Ana","password_hash":"$argon2id$v=19$..."}`
	require.NoError(t, s.Put(ctx, user.PurposeSignup, email, "hash-1", payload, time.Minute, time.Second))
	got, err := s.Check(ctx, user.PurposeSignup, email, "hash-1", 3)
	require.NoError(t, err)
	assert.Equal(t, payload, got)
}

func TestPurposesAreIndependent(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, user.PurposeSignup, email, "hash-1", "p", time.Minute, time.Second))
	_, err := s.Check(ctx, reset, email, "hash-1", 3)
	assert.ErrorIs(t, err, user.ErrInvalidCode, "a signup code is not a reset code")
	require.NoError(t, s.Put(ctx, reset, email, "hash-2", "", time.Minute, time.Second), "separate cooldowns")
	_, err = s.Check(ctx, user.PurposeSignup, email, "hash-1", 3)
	assert.NoError(t, err)
}

func TestCheckWithoutCode(t *testing.T) {
	s, email := newStore(t)
	_, err := s.Check(ctx, reset, email, "x", 3)
	assert.ErrorIs(t, err, user.ErrInvalidCode)
}

func TestThirdWrongAttemptDeletesTheCode(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, reset, email, "hash-1", "", time.Minute, time.Second))
	for i, want := range []error{user.ErrInvalidCode, user.ErrInvalidCode, user.ErrTooManyAttempts} {
		_, err := s.Check(ctx, reset, email, "bad", 3)
		assert.ErrorIs(t, err, want, "attempt %d", i+1)
	}
	_, err := s.Check(ctx, reset, email, "hash-1", 3)
	assert.ErrorIs(t, err, user.ErrInvalidCode, "right code is dead after exhaustion")
}

func TestCorrectCodeOnTheThirdAttemptStillWorks(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, reset, email, "hash-1", "", time.Minute, time.Second))
	for range 2 {
		_, err := s.Check(ctx, reset, email, "bad", 3)
		assert.ErrorIs(t, err, user.ErrInvalidCode)
	}
	_, err := s.Check(ctx, reset, email, "hash-1", 3)
	assert.NoError(t, err)
}

func TestPutHonoursCooldownAndKeepsTheCode(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, reset, email, "hash-1", "", time.Minute, 300*time.Millisecond))
	assert.ErrorIs(t, s.Put(ctx, reset, email, "hash-2", "", time.Minute, 300*time.Millisecond), user.ErrCodeTooSoon)
	_, err := s.Check(ctx, reset, email, "hash-1", 3)
	assert.NoError(t, err, "the rejected Put did not replace the code")
}

func TestNewCodeResetsAttemptsAndInvalidatesTheOldOne(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, reset, email, "old", "", time.Minute, 100*time.Millisecond))
	for range 2 {
		_, err := s.Check(ctx, reset, email, "bad", 3)
		assert.ErrorIs(t, err, user.ErrInvalidCode)
	}
	time.Sleep(150 * time.Millisecond)

	require.NoError(t, s.Put(ctx, reset, email, "new", "", time.Minute, time.Second))
	_, err := s.Check(ctx, reset, email, "old", 3)
	assert.ErrorIs(t, err, user.ErrInvalidCode)
	_, err = s.Check(ctx, reset, email, "bad", 3)
	assert.ErrorIs(t, err, user.ErrInvalidCode)
	_, err = s.Check(ctx, reset, email, "new", 3)
	assert.NoError(t, err, "attempts started again at zero")
}

func TestCodeExpires(t *testing.T) {
	s, email := newStore(t)
	require.NoError(t, s.Put(ctx, reset, email, "hash-1", "", 200*time.Millisecond, time.Second))
	time.Sleep(300 * time.Millisecond)
	_, err := s.Check(ctx, reset, email, "hash-1", 3)
	assert.ErrorIs(t, err, user.ErrInvalidCode)
}
