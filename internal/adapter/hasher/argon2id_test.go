package hasher

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fast keeps tests quick; production parameters come from NewArgon2id.
func fast() *Argon2id { return &Argon2id{memory: 64, time: 1, threads: 1} }

func TestHashVerify(t *testing.T) {
	h := fast()
	hash, err := h.Hash("correct horse")
	require.NoError(t, err)
	assert.Contains(t, hash, "$argon2id$v=19$m=64,t=1,p=1$")

	ok, err := h.Verify(hash, "correct horse")
	require.NoError(t, err)
	assert.True(t, ok)

	ok, err = h.Verify(hash, "wrong")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestHashIsSalted(t *testing.T) {
	a, _ := fast().Hash("same")
	b, _ := fast().Hash("same")
	assert.NotEqual(t, a, b)
}

func TestVerifyReadsParamsFromHash(t *testing.T) {
	hash, err := fast().Hash("pw")
	require.NoError(t, err)
	ok, err := NewArgon2id().Verify(hash, "pw")
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestDefaultParams(t *testing.T) {
	hash, err := NewArgon2id().Hash("pw")
	require.NoError(t, err)
	assert.Contains(t, hash, "$m=65536,t=3,p=2$")
}

func TestVerifyMalformed(t *testing.T) {
	for _, hash := range []string{
		"",
		"plain",
		"$bcrypt$10$a$b",
		"$argon2id$v=18$m=64,t=1,p=1$YQ$YQ",
		"$argon2id$v=19$m=0,t=1,p=1$YQ$YQ",
		"$argon2id$v=19$m=64,t=1,p=1$!!$YQ",
		"$argon2id$v=19$m=64,t=1,p=1$YQ$",
	} {
		_, err := fast().Verify(hash, "pw")
		assert.ErrorIs(t, err, ErrMalformedHash, hash)
	}
}
