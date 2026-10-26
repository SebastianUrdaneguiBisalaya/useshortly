package cache

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Needs a real Redis: REDIS_URL=redis://localhost:6379 go test ./internal/platform/cache/
func TestRedisStore(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL not set")
	}
	opts, err := redis.ParseURL(url)
	require.NoError(t, err)
	client := redis.NewClient(opts)
	t.Cleanup(func() { client.Close() })
	ctx := context.Background()
	require.NoError(t, client.Ping(ctx).Err())

	s := NewRedisStore(client)
	const key = "cache-test:key"
	t.Cleanup(func() { client.Del(ctx, key, key+"2") })

	_, found, err := s.Get(ctx, key)
	require.NoError(t, err)
	assert.False(t, found, "a miss is not an error")

	require.NoError(t, s.Set(ctx, key, []byte("v"), time.Minute))
	got, found, err := s.Get(ctx, key)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "v", string(got))
	ttl, err := client.TTL(ctx, key).Result()
	require.NoError(t, err)
	assert.Greater(t, ttl, time.Duration(0))

	require.NoError(t, s.Set(ctx, key+"2", []byte("w"), time.Minute))
	require.NoError(t, s.Del(ctx, key, key+"2"))
	_, found, err = s.Get(ctx, key)
	require.NoError(t, err)
	assert.False(t, found)
}
