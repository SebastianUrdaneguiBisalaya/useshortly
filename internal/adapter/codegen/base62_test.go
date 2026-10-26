package codegen

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBase62Generate(t *testing.T) {
	g := NewBase62()
	seen := make(map[string]struct{})
	for range 1000 {
		code, err := g.Generate()
		require.NoError(t, err)
		require.Len(t, code, codeLength)
		for _, r := range code {
			require.Containsf(t, alphabet, string(r), "code %q", code)
		}
		seen[code] = struct{}{}
	}
	assert.GreaterOrEqual(t, len(seen), 990, "too many collisions")
}
