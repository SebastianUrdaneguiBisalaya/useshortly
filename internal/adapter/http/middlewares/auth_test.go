package middlewares

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// {"alg":"EdDSA"} and {"alg":"HS256"} headers; the verifiers below ignore the rest.
const (
	edToken = "eyJhbGciOiJFZERTQSJ9.e30.sig"
	hsToken = "eyJhbGciOiJIUzI1NiJ9.e30.sig"
)

type fakeUsers struct {
	byID    map[int64]user.User
	jwtUser user.User
	jwtErr  error
}

func (f fakeUsers) Authenticate(context.Context, string) (user.User, error) {
	return f.jwtUser, f.jwtErr
}

func (f fakeUsers) ByID(_ context.Context, id int64) (user.User, error) {
	u, ok := f.byID[id]
	if !ok {
		return user.User{}, auth.ErrInvalidCredentials
	}
	return u, nil
}

type fakeKeys struct{}

func (fakeKeys) Authenticate(context.Context, string) (apikey.APIKey, error) {
	return apikey.APIKey{}, apikey.ErrNotFound
}

type fakeVerifier struct {
	claims auth.MCPClaims
	err    error
}

func (f fakeVerifier) Verify(context.Context, string) (auth.MCPClaims, error) {
	return f.claims, f.err
}

func serve(t *testing.T, a *Auth, protect func(http.Handler) http.Handler, token string) (*httptest.ResponseRecorder, handler.Principal) {
	t.Helper()
	var got handler.Principal
	h := protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = handler.PrincipalFrom(r)
		w.WriteHeader(http.StatusOK)
	}))
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec, got
}

func errCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return body.Error.Code
}

func newAuth(v auth.MCPTokenVerifier) *Auth {
	users := fakeUsers{
		byID:    map[int64]user.User{42: {ID: 42}},
		jwtUser: user.User{ID: 7},
	}
	a := NewAuth(users, fakeKeys{})
	if v != nil {
		a.WithMCP(v)
	}
	return a
}

func TestMCPTokenActsForTheUserWithItsScope(t *testing.T) {
	a := newAuth(fakeVerifier{claims: auth.MCPClaims{UserID: "42", Scope: auth.ScopeRead}})
	rec, p := serve(t, a, a.UserOrKey, edToken)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, p.ViaMCP())
	assert.False(t, p.ViaAPIKey())
	assert.Equal(t, int64(42), p.UserID)
	assert.Equal(t, apikey.ScopeRead, p.MCPScope)
}

func TestMCPTokenIsRefusedWhereOnlyUsersGo(t *testing.T) {
	a := newAuth(fakeVerifier{claims: auth.MCPClaims{UserID: "42", Scope: auth.ScopeWrite}})
	rec, _ := serve(t, a, a.User, edToken)
	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Equal(t, "mcp_token_not_allowed", errCode(t, rec))
}

func TestMCPTokenFailsClosed(t *testing.T) {
	tests := map[string]struct {
		a    *Auth
		code string
		want int
	}{
		"no verifier configured": {newAuth(nil), "invalid_credentials", http.StatusUnauthorized},
		"bad signature":          {newAuth(fakeVerifier{err: auth.ErrInvalidCredentials}), "invalid_credentials", http.StatusUnauthorized},
		"expired":                {newAuth(fakeVerifier{err: auth.ErrTokenExpired}), "token_expired", http.StatusUnauthorized},
		"deleted user":           {newAuth(fakeVerifier{claims: auth.MCPClaims{UserID: "99", Scope: auth.ScopeRead}}), "invalid_credentials", http.StatusUnauthorized},
		"non numeric subject":    {newAuth(fakeVerifier{claims: auth.MCPClaims{UserID: "abc", Scope: auth.ScopeRead}}), "invalid_credentials", http.StatusUnauthorized},
		"zero subject":           {newAuth(fakeVerifier{claims: auth.MCPClaims{UserID: "0", Scope: auth.ScopeRead}}), "invalid_credentials", http.StatusUnauthorized},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			rec, p := serve(t, tc.a, tc.a.UserOrKey, edToken)
			assert.Equal(t, tc.want, rec.Code)
			assert.Equal(t, tc.code, errCode(t, rec))
			assert.Contains(t, rec.Header().Get("WWW-Authenticate"), "Bearer")
			assert.Zero(t, p.UserID, "the handler must not run")
		})
	}
}

func TestUserJWTIsNeverCheckedAsAnMCPToken(t *testing.T) {
	// A verifier that would accept anything must not even be asked about an HS256 token.
	a := newAuth(fakeVerifier{claims: auth.MCPClaims{UserID: "42", Scope: auth.ScopeWrite}})
	rec, p := serve(t, a, a.UserOrKey, hsToken)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.False(t, p.ViaMCP())
	assert.Equal(t, int64(7), p.UserID, "resolved by the user JWT path")
}

func TestScopeCapsMCPButNotUsers(t *testing.T) {
	run := func(p handler.Principal, required apikey.Scope) int {
		h := Scope(required)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r = r.WithContext(handler.WithPrincipal(r.Context(), p))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec.Code
	}
	read := handler.Principal{UserID: 1, MCPScope: apikey.ScopeRead}
	write := handler.Principal{UserID: 1, MCPScope: apikey.ScopeWrite}
	assert.Equal(t, http.StatusOK, run(read, apikey.ScopeRead))
	assert.Equal(t, http.StatusForbidden, run(read, apikey.ScopeWrite))
	assert.Equal(t, http.StatusOK, run(write, apikey.ScopeWrite))
	assert.Equal(t, http.StatusOK, run(handler.Principal{UserID: 1}, apikey.ScopeWrite), "JWT users are not capped")
}
