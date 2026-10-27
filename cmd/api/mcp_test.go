package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/auth/mcptoken"
	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mcpKey plays the MCP server: the API under test only gets its public half.
var mcpKey = func() (k struct {
	pub  ed25519.PublicKey
	priv ed25519.PrivateKey
}) {
	var err error
	if k.pub, k.priv, err = ed25519.GenerateKey(rand.Reader); err != nil {
		panic(err)
	}
	return k
}()

type mcpClaims struct {
	jwtlib.RegisteredClaims
	Scope string `json:"scope"`
}

func mcpToken(t *testing.T, key ed25519.PrivateKey, userID, scope string, mutate func(*mcpClaims)) string {
	t.Helper()
	now := time.Now()
	c := mcpClaims{
		RegisteredClaims: jwtlib.RegisteredClaims{
			Issuer:    mcptoken.Issuer,
			Audience:  jwtlib.ClaimStrings{mcptoken.Audience},
			Subject:   userID,
			IssuedAt:  jwtlib.NewNumericDate(now),
			ExpiresAt: jwtlib.NewNumericDate(now.Add(time.Minute)),
		},
		Scope: scope,
	}
	if mutate != nil {
		mutate(&c)
	}
	s, err := jwtlib.NewWithClaims(jwtlib.SigningMethodEdDSA, c).SignedString(key)
	require.NoError(t, err)
	return s
}

func TestMCPTokens(t *testing.T) {
	e := newEnv(t, false)
	ana := e.signUp("ana@example.com", "Ana")
	bob := e.signUp("bob@example.com", "Bob")
	acme := e.createOrg(ana, "Acme")
	anaID := strconv.FormatInt(int64(e.do("GET", "/api/v1/me", ana, nil).body["id"].(float64)), 10)
	bobID := strconv.FormatInt(int64(e.do("GET", "/api/v1/me", bob, nil).body["id"].(float64)), 10)
	links := "/api/v1/orgs/" + acme + "/links"
	body := map[string]string{"url": "https://example.com/mcp"}

	read := mcpToken(t, mcpKey.priv, anaID, "read", nil)
	write := mcpToken(t, mcpKey.priv, anaID, "write", nil)

	// The scope caps what the token can do for the user.
	assert.Equal(t, http.StatusOK, e.do("GET", links, read, nil).status)
	res := e.do("POST", links, read, body)
	assert.Equal(t, http.StatusForbidden, res.status)
	assert.Equal(t, "insufficient_scope", res.errCode())
	assert.Equal(t, http.StatusCreated, e.do("POST", links, write, body).status)

	// The read-only account views are open to an MCP token with the read scope...
	for _, tok := range []string{read, write} {
		me := e.do("GET", "/api/v1/me", tok, nil)
		require.Equal(t, http.StatusOK, me.status, me.raw)
		assert.Equal(t, "ana@example.com", me.str("email"))
		assert.Equal(t, http.StatusOK, e.do("GET", "/api/v1/orgs", tok, nil).status)
	}
	assert.Contains(t, e.do("GET", "/api/v1/orgs", read, nil).raw, "Acme")

	// ...and nothing else about accounts or organizations, whatever the scope.
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/v1/orgs"},
		{"DELETE", "/api/v1/me"},
		{"POST", "/api/v1/me/delete-code"},
		{"GET", "/api/v1/orgs/" + acme},
		{"DELETE", "/api/v1/orgs/" + acme},
		{"GET", "/api/v1/orgs/" + acme + "/members"},
		{"POST", "/api/v1/orgs/" + acme + "/invitations"},
		{"GET", "/api/v1/orgs/" + acme + "/api-keys"},
		{"POST", "/api/v1/orgs/" + acme + "/api-keys"},
	} {
		assert.Equal(t, "mcp_token_not_allowed", e.do(c.method, c.path, write, nil).errCode(), c.method+" "+c.path)
	}

	// An API key still cannot see the account views.
	key := e.do("POST", "/api/v1/orgs/"+acme+"/api-keys", ana, map[string]string{"name": "ci", "scope": "write"})
	require.Equal(t, http.StatusCreated, key.status, key.raw)
	for _, p := range []string{"/api/v1/me", "/api/v1/orgs"} {
		assert.Equal(t, "api_key_not_allowed", e.do("GET", p, key.str("secret"), nil).errCode(), p)
	}

	// It acts as that user: Bob is not a member of Acme.
	bobWrite := mcpToken(t, mcpKey.priv, bobID, "write", nil)
	assert.Equal(t, http.StatusForbidden, e.do("POST", links, bobWrite, body).status)

	// Everything else fails closed.
	_, otherKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	bad := map[string]string{
		"unknown user":   mcpToken(t, mcpKey.priv, "99999", "write", nil),
		"other signer":   mcpToken(t, otherKey, anaID, "write", nil),
		"wrong audience": mcpToken(t, mcpKey.priv, anaID, "write", func(c *mcpClaims) { c.Audience = jwtlib.ClaimStrings{"other"} }),
		"wrong issuer":   mcpToken(t, mcpKey.priv, anaID, "write", func(c *mcpClaims) { c.Issuer = "other" }),
		"unknown scope":  mcpToken(t, mcpKey.priv, anaID, "admin", nil),
		"expired": mcpToken(t, mcpKey.priv, anaID, "write", func(c *mcpClaims) {
			c.ExpiresAt = jwtlib.NewNumericDate(time.Now().Add(-time.Hour))
			c.IssuedAt = jwtlib.NewNumericDate(time.Now().Add(-2 * time.Hour))
		}),
		"long lived": mcpToken(t, mcpKey.priv, anaID, "write", func(c *mcpClaims) { c.ExpiresAt = jwtlib.NewNumericDate(time.Now().Add(24 * time.Hour)) }),
	}
	for name, tok := range bad {
		assert.Equal(t, http.StatusUnauthorized, e.do("GET", links, tok, nil).status, name)
	}
}

// With no MCP_PUBLIC_KEY configured, EdDSA tokens are refused outright.
func TestMCPTokensAreRefusedWhenNotConfigured(t *testing.T) {
	h := newAuthMiddleware(nil, nil, nil).UserOrKey(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("the handler must not run")
	}))
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+mcpToken(t, mcpKey.priv, "1", "write", nil))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}
