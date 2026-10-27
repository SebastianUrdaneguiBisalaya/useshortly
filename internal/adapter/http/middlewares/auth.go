// Package middlewares holds the HTTP middlewares: who is calling (Auth) and which
// organization they act on (Tenant).
package middlewares

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

// userService and keyService are what Auth needs from the domain.
type userService interface {
	Authenticate(ctx context.Context, token string) (user.User, error)
	ByID(ctx context.Context, id int64) (user.User, error)
}

type keyService interface {
	Authenticate(ctx context.Context, secret string) (apikey.APIKey, error)
}

type Auth struct {
	users userService
	keys  keyService
	mcp   auth.MCPTokenVerifier // nil: MCP tokens are refused
}

func NewAuth(users userService, keys keyService) *Auth {
	return &Auth{users: users, keys: keys}
}

// WithMCP lets the MCP server call the API on behalf of a user. Its tokens are EdDSA JWTs,
// told apart from user JWTs (HS256) by the header algorithm, never by trial and error.
func (a *Auth) WithMCP(v auth.MCPTokenVerifier) *Auth {
	a.mcp = v
	return a
}

// allowed says which credentials besides a user JWT a route accepts.
type allowed struct{ key, mcp bool }

// User requires a JWT. API keys and MCP tokens are refused: they cannot manage accounts or
// organizations.
func (a *Auth) User(next http.Handler) http.Handler { return a.require(next, allowed{}) }

// UserOrKey accepts a JWT, an API key ("usl_...") or an MCP token.
func (a *Auth) UserOrKey(next http.Handler) http.Handler {
	return a.require(next, allowed{key: true, mcp: true})
}

// UserOrMCP accepts a JWT or an MCP token, never an API key: for the read-only account views an
// MCP client needs (who am I, which organizations do I belong to), which a tenant-bound key has
// no business seeing.
func (a *Auth) UserOrMCP(next http.Handler) http.Handler { return a.require(next, allowed{mcp: true}) }

func (a *Auth) require(next http.Handler, allow allowed) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, fromCookie, ok := credentials(r)
		if !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="useshortly"`)
			handler.WriteAPIError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token or session cookie")
			return
		}
		var (
			p   handler.Principal
			err error
		)
		switch {
		case fromCookie:
			// The session cookie only ever holds a user JWT; API keys and MCP tokens must come in the header.
			p, err = a.userToken(r.Context(), token)
		case strings.HasPrefix(token, "usl_"):
			if !allow.key {
				handler.WriteAPIError(w, http.StatusForbidden, "api_key_not_allowed", "api keys cannot be used on this endpoint")
				return
			}
			p, err = a.apiKey(r.Context(), token)
		case tokenAlg(token) == "EdDSA":
			if !allow.mcp {
				handler.WriteAPIError(w, http.StatusForbidden, "mcp_token_not_allowed", "mcp tokens cannot be used on this endpoint")
				return
			}
			p, err = a.mcpToken(r.Context(), token)
		default:
			p, err = a.userToken(r.Context(), token)
		}
		if err != nil {
			if errors.Is(err, auth.ErrInvalidCredentials) || errors.Is(err, auth.ErrTokenExpired) || errors.Is(err, apikey.ErrNotFound) {
				w.Header().Set("WWW-Authenticate", `Bearer realm="useshortly"`)
			}
			if errors.Is(err, apikey.ErrNotFound) {
				handler.WriteAPIError(w, http.StatusUnauthorized, "unauthorized", "invalid api key")
				return
			}
			handler.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(handler.WithPrincipal(r.Context(), p)))
	})
}

func (a *Auth) apiKey(ctx context.Context, token string) (handler.Principal, error) {
	k, err := a.keys.Authenticate(ctx, token)
	if err != nil {
		return handler.Principal{}, err
	}
	return handler.Principal{UserID: k.CreatedBy, KeyTenantID: k.TenantID, KeyScope: k.Scope}, nil
}

func (a *Auth) userToken(ctx context.Context, token string) (handler.Principal, error) {
	u, err := a.users.Authenticate(ctx, token)
	if err != nil {
		return handler.Principal{}, err
	}
	return handler.Principal{UserID: u.ID, User: u}, nil
}

// mcpToken checks the signature and then that the user still exists, on every request, so
// deleting an account cuts the MCP access at once.
func (a *Auth) mcpToken(ctx context.Context, token string) (handler.Principal, error) {
	if a.mcp == nil {
		return handler.Principal{}, auth.ErrInvalidCredentials
	}
	c, err := a.mcp.Verify(ctx, token)
	if err != nil {
		return handler.Principal{}, err
	}
	id, err := strconv.ParseInt(c.UserID, 10, 64)
	if err != nil || id <= 0 {
		return handler.Principal{}, auth.ErrInvalidCredentials
	}
	u, err := a.users.ByID(ctx, id)
	if err != nil {
		return handler.Principal{}, err
	}
	return handler.Principal{UserID: u.ID, User: u, MCPScope: apikey.Scope(c.Scope)}, nil
}

// tokenAlg reads the "alg" of a JWT header without trusting it for anything but routing:
// the verifier that gets the token pins the algorithm itself.
func tokenAlg(token string) string {
	head, _, ok := strings.Cut(token, ".")
	if !ok {
		return ""
	}
	raw, err := base64.RawURLEncoding.DecodeString(head)
	if err != nil {
		return ""
	}
	var h struct {
		Alg string `json:"alg"`
	}
	if json.Unmarshal(raw, &h) != nil {
		return ""
	}
	return h.Alg
}

// credentials finds the caller's token: the Authorization header wins (API keys, MCP clients,
// scripts), otherwise the session cookie the web app signed in with.
func credentials(r *http.Request) (token string, fromCookie, ok bool) {
	if token, ok := bearer(r); ok {
		return token, false, true
	}
	if c, err := r.Cookie(handler.AccessCookie); err == nil && c.Value != "" {
		return c.Value, true, true
	}
	return "", false, false
}

func bearer(r *http.Request) (string, bool) {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return "", false
	}
	return token, true
}
