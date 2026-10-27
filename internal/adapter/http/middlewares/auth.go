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

// User requires a JWT. API keys and MCP tokens are refused: they cannot manage accounts or
// organizations.
func (a *Auth) User(next http.Handler) http.Handler { return a.require(next, false) }

// UserOrKey accepts a JWT, an API key ("usl_...") or an MCP token.
func (a *Auth) UserOrKey(next http.Handler) http.Handler { return a.require(next, true) }

func (a *Auth) require(next http.Handler, allowDelegated bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearer(r)
		if !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="useshortly"`)
			handler.WriteAPIError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
			return
		}
		var (
			p   handler.Principal
			err error
		)
		switch {
		case strings.HasPrefix(token, "usl_"):
			if !allowDelegated {
				handler.WriteAPIError(w, http.StatusForbidden, "api_key_not_allowed", "api keys cannot be used on this endpoint")
				return
			}
			p, err = a.apiKey(r.Context(), token)
		case tokenAlg(token) == "EdDSA":
			if !allowDelegated {
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

func bearer(r *http.Request) (string, bool) {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return "", false
	}
	return token, true
}
