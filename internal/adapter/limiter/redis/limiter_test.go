package redis

import (
	"context"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Needs a real Redis (it runs a Lua script): REDIS_URL=redis://localhost:6379 go test ./internal/adapter/limiter/...
func newLimiter(t *testing.T) (*Limiter, *goredis.Client, string) {
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
	key := "limiter-test:" + t.Name()
	client.Del(ctx, attemptsKey(key))
	t.Cleanup(func() { client.Del(ctx, attemptsKey(key)) })
	return NewLimiter(client), client, key
}

func TestTakeAllowsUpToTheLimit(t *testing.T) {
	l, client, key := newLimiter(t)
	ctx := context.Background()
	for i := 1; i <= 3; i++ {
		ok, err := l.Take(ctx, key, 3, time.Minute)
		require.NoError(t, err)
		assert.True(t, ok, "attempt %d", i)
	}
	ok, err := l.Take(ctx, key, 3, time.Minute)
	require.NoError(t, err)
	assert.False(t, ok, "the fourth attempt is refused")

	ttl, err := client.PTTL(ctx, attemptsKey(key)).Result()
	require.NoError(t, err)
	assert.Greater(t, ttl, time.Duration(0))
	assert.LessOrEqual(t, ttl, time.Minute)
}

func TestTakeStartsANewWindowAfterItExpires(t *testing.T) {
	l, _, key := newLimiter(t)
	ctx := context.Background()
	for range 2 {
		_, err := l.Take(ctx, key, 1, 100*time.Millisecond)
		require.NoError(t, err)
	}
	time.Sleep(200 * time.Millisecond)
	ok, err := l.Take(ctx, key, 1, 100*time.Millisecond)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestResetClearsTheCount(t *testing.T) {
	l, _, key := newLimiter(t)
	ctx := context.Background()
	for range 3 {
		_, err := l.Take(ctx, key, 3, time.Minute)
		require.NoError(t, err)
	}
	require.NoError(t, l.Reset(ctx, key))
	ok, err := l.Take(ctx, key, 3, time.Minute)
	require.NoError(t, err)
	assert.True(t, ok)
	require.NoError(t, l.Reset(ctx, "limiter-test:never-used"), "resetting nothing is fine")
}

func TestParallelGuessesCannotPassTheLimit(t *testing.T) {
	l, _, key := newLimiter(t)
	var allowed atomic.Int64
	var wg sync.WaitGroup
	for range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, err := l.Take(context.Background(), key, 3, time.Minute); err == nil && ok {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()
	assert.EqualValues(t, 3, allowed.Load())
}
