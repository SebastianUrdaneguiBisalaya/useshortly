package codegen

import (
	"strings"
	"testing"
)

func TestBase62Generate(t *testing.T) {
	g := NewBase62()
	seen := make(map[string]struct{})
	for range 1000 {
		code, err := g.Generate()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(code) != codeLength {
			t.Fatalf("code %q: want length %d, got %d", code, codeLength, len(code))
		}
		for _, r := range code {
			if !strings.ContainsRune(alphabet, r) {
				t.Fatalf("code %q has invalid char %q", code, r)
			}
		}
		seen[code] = struct{}{}
	}
	if len(seen) < 990 {
		t.Fatalf("too many collisions: %d unique of 1000", len(seen))
	}
}
