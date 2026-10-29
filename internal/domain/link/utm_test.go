package link

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWithUTM(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"plain", "https://example.com/a", "https://example.com/a?utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday"},
		{"keeps other params in order", "https://example.com/a?b=2&a=1", "https://example.com/a?b=2&a=1&utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday"},
		{"replaces its own", "https://example.com/?utm_source=x&a=1&utm_campaign=y&utm_medium=z", "https://example.com/?a=1&utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday"},
		{"keeps utm_term and utm_content", "https://example.com/?utm_term=t&utm_content=c", "https://example.com/?utm_term=t&utm_content=c&utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday"},
		{"keeps the fragment", "https://example.com/a?b=2#top", "https://example.com/a?b=2&utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday#top"},
		{"fragment without query", "https://example.com/a#top", "https://example.com/a?utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday#top"},
		{"empty query", "https://example.com/a?", "https://example.com/a?utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday"},
		{"keeps encoded values verbatim", "https://example.com/?q=a%20b&r=%C3%B1", "https://example.com/?q=a%20b&r=%C3%B1&utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday"},
		{"encoded key is still its own", "https://example.com/?utm%5Fsource=x", "https://example.com/?utm_source=Instagram&utm_medium=useshortly&utm_campaign=Black+Friday"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, withUTM(tt.in, "Black Friday", "Instagram"))
		})
	}
}

func TestWithUTMEscapesValues(t *testing.T) {
	got := withUTM("https://example.com/", "a&b=c#d", "x y")
	assert.Equal(t, "https://example.com/?utm_source=x+y&utm_medium=useshortly&utm_campaign=a%26b%3Dc%23d", got)
}

func TestWithoutUTM(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"nothing to remove", "https://example.com/a", "https://example.com/a"},
		{"only ours", "https://example.com/a?utm_source=x&utm_medium=useshortly&utm_campaign=y", "https://example.com/a"},
		{"keeps the rest", "https://example.com/a?b=2&utm_source=x&c=3&utm_campaign=y", "https://example.com/a?b=2&c=3"},
		{"keeps the fragment", "https://example.com/a?utm_source=x#top", "https://example.com/a#top"},
		{"keeps utm_term", "https://example.com/a?utm_term=t&utm_source=x", "https://example.com/a?utm_term=t"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, withoutUTM(tt.in))
		})
	}
}

func TestWithUTMRoundTrips(t *testing.T) {
	in := "https://example.com/a?b=2#top"
	assert.Equal(t, in, withoutUTM(withUTM(in, "c", "s")))
}
