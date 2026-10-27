package middlewares

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/httprate"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
)

// Rate is Requests allowed every Per.
type Rate struct {
	Requests int
	Per      time.Duration
}

// RateLimits builds the limits that protect the endpoints from floods and guessing. Each method
// returns a new middleware with its own counters: apply one value to every route that should share
// a budget (all the sign-in routes spend from the same one), and call the method again for
// a separate budget. Counters live in this process, so with several instances each enforces its own
// limit. A nil *RateLimits limits nothing.
type RateLimits struct {
	trustProxy bool

	// Strict covers the public auth routes, where each request can cost an argon2id hash or an email.
	Strict Rate
	// Refresh covers refreshing and ending sessions.
	Refresh Rate
	// Unlock covers password tries on protected links (they also have a backoff of their own).
	Unlock Rate
	// Redirect covers the public short links; it is high because many visitors may share an address.
	Redirect Rate
	// API covers signed-in callers, per user or API key rather than per address.
	API Rate
}

// DefaultRateLimits is a sensible starting point. With trustProxy the visitor's address is read
// from X-Forwarded-For, like everywhere else (see handler.ClientIP).
func DefaultRateLimits(trustProxy bool) *RateLimits {
	return &RateLimits{
		trustProxy: trustProxy,
		Strict:     Rate{10, time.Minute},
		Refresh:    Rate{30, time.Minute},
		Unlock:     Rate{20, time.Minute},
		Redirect:   Rate{300, time.Minute},
		API:        Rate{600, time.Minute},
	}
}

type middleware = func(http.Handler) http.Handler

func passThrough(next http.Handler) http.Handler { return next }

func (l *RateLimits) StrictPerIP() middleware {
	return l.perIP(func(l *RateLimits) Rate { return l.Strict })
}
func (l *RateLimits) RefreshPerIP() middleware {
	return l.perIP(func(l *RateLimits) Rate { return l.Refresh })
}
func (l *RateLimits) UnlockPerIP() middleware {
	return l.perIP(func(l *RateLimits) Rate { return l.Unlock })
}
func (l *RateLimits) RedirectPerIP() middleware {
	return l.perIP(func(l *RateLimits) Rate { return l.Redirect })
}

func (l *RateLimits) perIP(pick func(*RateLimits) Rate) middleware {
	if l == nil {
		return passThrough
	}
	rate := pick(l)
	trust := l.trustProxy
	return httprate.LimitBy(rate.Requests, rate.Per, func(r *http.Request) (string, error) {
		ip := handler.ClientIP(r, trust)
		if !ip.IsValid() {
			return "unknown", nil // one shared bucket: stricter, never a bypass
		}
		return httprate.CanonicalizeIP(ip.String()), nil
	}, httprate.WithLimitHandler(limited))
}

// PerPrincipal limits signed-in callers by who they are, not where they come from, so an office
// behind one address does not share a budget. A user and the API keys of that user have separate
// ones. It must run after Auth.
func (l *RateLimits) PerPrincipal() middleware {
	if l == nil {
		return passThrough
	}
	return httprate.LimitBy(l.API.Requests, l.API.Per, func(r *http.Request) (string, error) {
		p := handler.PrincipalFrom(r)
		if p.ViaMCP() {
			return "mcp:" + strconv.FormatInt(p.UserID, 10), nil
		}
		if p.ViaAPIKey() {
			return "key:" + strconv.FormatInt(p.UserID, 10), nil
		}
		return "user:" + strconv.FormatInt(p.UserID, 10), nil
	}, httprate.WithLimitHandler(limited))
}

// limited answers a refused request with the usual JSON error. httprate has already set
// Retry-After and the X-RateLimit-* headers.
func limited(w http.ResponseWriter, _ *http.Request) {
	handler.WriteAPIError(w, http.StatusTooManyRequests, "rate_limited",
		"too many requests, slow down and try again in a moment")
}
