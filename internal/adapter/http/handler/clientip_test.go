package handler

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClientIP(t *testing.T) {
	tests := []struct {
		name       string
		remote     string
		xff        string
		trustProxy bool
		want       string
	}{
		{"remote address", "203.0.113.7:51234", "", false, "203.0.113.7"},
		{"forwarded header is ignored by default", "10.0.0.2:80", "198.51.100.9", false, "10.0.0.2"},
		{"trusted proxy: first forwarded entry", "10.0.0.2:80", "198.51.100.9, 10.0.0.2", true, "198.51.100.9"},
		{"trusted proxy: single entry", "10.0.0.2:80", "198.51.100.9", true, "198.51.100.9"},
		{"trusted proxy but no header", "203.0.113.7:51234", "", true, "203.0.113.7"},
		{"trusted proxy, unreadable header", "203.0.113.7:51234", "garbage", true, "203.0.113.7"},
		{"ipv6", "[2001:db8::1]:443", "", false, "2001:db8::1"},
		{"ipv4 in ipv6 form", "[::ffff:203.0.113.7]:443", "", false, "203.0.113.7"},
		{"no port", "203.0.113.7", "", false, "203.0.113.7"},
		{"unknown", "not-an-ip", "", false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = tt.remote
			if tt.xff != "" {
				r.Header.Set("X-Forwarded-For", tt.xff)
			}
			got := clientIP(r, tt.trustProxy)
			if tt.want == "" {
				assert.False(t, got.IsValid())
				return
			}
			assert.Equal(t, netip.MustParseAddr(tt.want), got)
		})
	}
}
