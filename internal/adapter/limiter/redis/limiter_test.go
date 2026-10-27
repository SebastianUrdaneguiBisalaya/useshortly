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

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
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

var policy = link.Backoff{Free: 3, Base: 30 * time.Second, Max: time.Hour, Memory: time.Minute}

func TestTriesAreFreeAndThenWait(t *testing.T) {
	l, client, key := newLimiter(t)
	ctx := context.Background()

	for n := 1; n <= 2; n++ {
		ok, wait, err := l.Take(ctx, key, policy)
		require.NoError(t, err)
		assert.True(t, ok, "try %d", n)
		assert.Zero(t, wait, "try %d is free", n)
	}
	ok, wait, err := l.Take(ctx, key, policy)
	require.NoError(t, err)
	assert.True(t, ok, "the third try still goes ahead")
	assert.Equal(t, policy.DelayAfter(3), wait, "and is followed by the first wait")

	ok, left, err := l.Take(ctx, key, policy)
	require.NoError(t, err)
	assert.False(t, ok, "the next try has to wait")
	assert.Greater(t, left, time.Duration(0))
	assert.LessOrEqual(t, left, 30*time.Second)

	n, err := client.HGet(ctx, attemptsKey(key), "n").Int()
	require.NoError(t, err)
	assert.Equal(t, 3, n, "a refused try is not counted")
}

func TestTheWaitDoublesUpToTheMax(t *testing.T) {
	l, client, key := newLimiter(t)
	ctx := context.Background()
	for n := 1; n <= 9; n++ {
		// Skip the wait: pretend it already passed.
		client.HSet(ctx, attemptsKey(key), "until", 0)
		ok, wait, err := l.Take(ctx, key, link.Backoff{Free: 3, Base: 30 * time.Second, Max: 5 * time.Minute, Memory: time.Minute})
		require.NoError(t, err)
		require.True(t, ok)
		want := link.Backoff{Free: 3, Base: 30 * time.Second, Max: 5 * time.Minute}.DelayAfter(n)
		assert.Equal(t, want, wait, "wait after try %d", n)
	}
}

func TestAFreshWindowAfterTheMemoryExpires(t *testing.T) {
	l, _, key := newLimiter(t)
	ctx := context.Background()
	short := link.Backoff{Free: 1, Base: time.Hour, Max: time.Hour, Memory: 150 * time.Millisecond}
	ok, _, err := l.Take(ctx, key, short)
	require.NoError(t, err)
	require.True(t, ok)
	ok, _, _ = l.Take(ctx, key, short)
	assert.False(t, ok, "waiting")
	time.Sleep(300 * time.Millisecond)
	ok, wait, err := l.Take(ctx, key, short)
	require.NoError(t, err)
	assert.True(t, ok, "forgiven")
	assert.Equal(t, time.Hour, wait)
}

func TestResetClearsTheWait(t *testing.T) {
	l, _, key := newLimiter(t)
	ctx := context.Background()
	for range 3 {
		_, _, err := l.Take(ctx, key, policy)
		require.NoError(t, err)
	}
	ok, _, _ := l.Take(ctx, key, policy)
	require.False(t, ok)
	require.NoError(t, l.Reset(ctx, key))
	ok, wait, err := l.Take(ctx, key, policy)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Zero(t, wait)
	require.NoError(t, l.Reset(ctx, "limiter-test:never-used"), "resetting nothing is fine")
}

func TestParallelGuessesCannotPassTheFreeTries(t *testing.T) {
	l, _, key := newLimiter(t)
	var allowed atomic.Int64
	var wg sync.WaitGroup
	for range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, _, err := l.Take(context.Background(), key, policy); err == nil && ok {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()
	assert.EqualValues(t, 3, allowed.Load(), "exactly the free tries, however many ask at once")
}
