package middlewares

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
)

var ok200 = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })

func limits(trustProxy bool) *RateLimits {
	l := DefaultRateLimits(trustProxy)
	l.Strict = Rate{3, time.Minute}
	l.Redirect = Rate{2, time.Minute}
	l.API = Rate{2, time.Minute}
	return l
}

func call(h http.Handler, remote string, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remote
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func TestPerIPLimitsAndAnswersWithTheUsualJSONError(t *testing.T) {
	h := limits(false).StrictPerIP()(ok200)
	for i := 1; i <= 3; i++ {
		rec := call(h, "203.0.113.7:1000", nil)
		assert.Equal(t, http.StatusOK, rec.Code, "request %d", i)
	}
	rec := call(h, "203.0.113.7:1001", nil)
	assert.Equal(t, http.StatusTooManyRequests, rec.Code, "the port does not matter, the address does")
	assert.Contains(t, rec.Body.String(), `"code":"rate_limited"`)
	assert.Contains(t, rec.Header().Get("Content-Type"), "application/json")
	retry, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	require.NoError(t, err)
	assert.Positive(t, retry)
	assert.Equal(t, "3", rec.Header().Get("X-RateLimit-Limit"))

	assert.Equal(t, http.StatusOK, call(h, "203.0.113.8:1000", nil).Code, "another address has its own budget")
}

func TestOneMiddlewareIsOneBudgetAndANewOneIsAnother(t *testing.T) {
	l := limits(false)
	shared := l.StrictPerIP()
	login, register := shared(ok200), shared(ok200)
	for range 2 {
		assert.Equal(t, http.StatusOK, call(login, "203.0.113.7:1", nil).Code)
	}
	assert.Equal(t, http.StatusOK, call(register, "203.0.113.7:1", nil).Code, "the third request of the shared budget")
	assert.Equal(t, http.StatusTooManyRequests, call(register, "203.0.113.7:1", nil).Code, "login and register spend from the same one")

	other := l.StrictPerIP()(ok200)
	assert.Equal(t, http.StatusOK, call(other, "203.0.113.7:1", nil).Code, "a separate middleware starts fresh")
}

func TestIPv6ClientsShareTheirSlash64(t *testing.T) {
	h := limits(false).StrictPerIP()(ok200)
	for _, remote := range []string{"[2001:db8:1:2::1]:1", "[2001:db8:1:2::2]:1", "[2001:db8:1:2:ffff::9]:1"} {
		assert.Equal(t, http.StatusOK, call(h, remote, nil).Code, remote)
	}
	assert.Equal(t, http.StatusTooManyRequests, call(h, "[2001:db8:1:2:abcd::1]:1", nil).Code,
		"rotating inside the same /64 does not give a fresh budget")
	assert.Equal(t, http.StatusOK, call(h, "[2001:db8:1:3::1]:1", nil).Code, "another /64 does")
}

func TestForwardedForOnlyCountsWhenTheProxyIsTrusted(t *testing.T) {
	t.Run("ignored by default, so it cannot be used to dodge the limit", func(t *testing.T) {
		h := limits(false).StrictPerIP()(ok200)
		for i := range 3 {
			assert.Equal(t, http.StatusOK, call(h, "10.0.0.2:1", map[string]string{"X-Forwarded-For": "198.51.100." + strconv.Itoa(i)}).Code)
		}
		assert.Equal(t, http.StatusTooManyRequests, call(h, "10.0.0.2:1", map[string]string{"X-Forwarded-For": "198.51.100.99"}).Code)
	})

	t.Run("behind a trusted proxy each client has a budget", func(t *testing.T) {
		h := limits(true).StrictPerIP()(ok200)
		for range 3 {
			assert.Equal(t, http.StatusOK, call(h, "10.0.0.2:1", map[string]string{"X-Forwarded-For": "198.51.100.1"}).Code)
		}
		assert.Equal(t, http.StatusTooManyRequests, call(h, "10.0.0.2:1", map[string]string{"X-Forwarded-For": "198.51.100.1"}).Code)
		assert.Equal(t, http.StatusOK, call(h, "10.0.0.2:1", map[string]string{"X-Forwarded-For": "198.51.100.2"}).Code)
	})
}

func TestAnUnknownAddressSharesOneBucketInsteadOfEscapingTheLimit(t *testing.T) {
	h := limits(false).StrictPerIP()(ok200)
	for range 3 {
		assert.Equal(t, http.StatusOK, call(h, "not-an-address", nil).Code)
	}
	assert.Equal(t, http.StatusTooManyRequests, call(h, "also-not-one", nil).Code)
}

func TestPerPrincipalSeparatesUsersAndTheirKeys(t *testing.T) {
	h := limits(false).PerPrincipal()(ok200)
	as := func(p handler.Principal) int {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = "203.0.113.7:1" // everyone comes from the same address
		r = r.WithContext(handler.WithPrincipal(r.Context(), p))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec.Code
	}
	ana, bob := handler.Principal{UserID: 1}, handler.Principal{UserID: 2}
	anaKey := handler.Principal{UserID: 1, KeyTenantID: 9}

	assert.Equal(t, http.StatusOK, as(ana))
	assert.Equal(t, http.StatusOK, as(ana))
	assert.Equal(t, http.StatusTooManyRequests, as(ana))
	assert.Equal(t, http.StatusOK, as(bob), "another user behind the same address is not affected")
	assert.Equal(t, http.StatusOK, as(anaKey), "a script using Ana's API key does not use up Ana's own budget")
}

func TestNoLimitsLimitsNothing(t *testing.T) {
	var l *RateLimits
	for _, mw := range []middleware{l.StrictPerIP(), l.RefreshPerIP(), l.UnlockPerIP(), l.RedirectPerIP(), l.PerPrincipal()} {
		h := mw(ok200)
		for range 50 {
			require.Equal(t, http.StatusOK, call(h, "203.0.113.7:1", nil).Code)
		}
	}
}

func TestPerPrincipalGivesMCPCallsTheirOwnBudget(t *testing.T) {
	h := limits(false).PerPrincipal()(ok200)
	as := func(p handler.Principal) int {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = "203.0.113.7:1"
		r = r.WithContext(handler.WithPrincipal(r.Context(), p))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec.Code
	}
	ana := handler.Principal{UserID: 1}
	anaMCP := handler.Principal{UserID: 1, MCPScope: apikey.ScopeRead}

	assert.Equal(t, http.StatusOK, as(anaMCP))
	assert.Equal(t, http.StatusOK, as(anaMCP))
	assert.Equal(t, http.StatusTooManyRequests, as(anaMCP))
	assert.Equal(t, http.StatusOK, as(ana), "an AI client does not use up Ana's own budget")
}
