// Package middlewares holds the HTTP middlewares: who is calling (Auth) and which
// organization they act on (Tenant).
package middlewares

import (
	"errors"
	"net/http"
	"strings"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

type Auth struct {
	users *user.Service
	keys  *apikey.Service
}

func NewAuth(users *user.Service, keys *apikey.Service) *Auth {
	return &Auth{users: users, keys: keys}
}

// User requires a JWT. API keys are refused: they cannot manage accounts or organizations.
func (a *Auth) User(next http.Handler) http.Handler { return a.require(next, false) }

// UserOrKey accepts a JWT or an API key ("usl_...").
func (a *Auth) UserOrKey(next http.Handler) http.Handler { return a.require(next, true) }

func (a *Auth) require(next http.Handler, allowKey bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearer(r)
		if !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="useshortly"`)
			handler.WriteAPIError(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
			return
		}
		var p handler.Principal
		if strings.HasPrefix(token, "usl_") {
			if !allowKey {
				handler.WriteAPIError(w, http.StatusForbidden, "api_key_not_allowed", "api keys cannot be used on this endpoint")
				return
			}
			k, err := a.keys.Authenticate(r.Context(), token)
			if errors.Is(err, apikey.ErrNotFound) {
				handler.WriteAPIError(w, http.StatusUnauthorized, "unauthorized", "invalid api key")
				return
			}
			if err != nil {
				handler.WriteError(w, r, err)
				return
			}
			p = handler.Principal{UserID: k.CreatedBy, KeyTenantID: k.TenantID, KeyScope: k.Scope}
		} else {
			u, err := a.users.Authenticate(r.Context(), token)
			if err != nil {
				if errors.Is(err, auth.ErrInvalidCredentials) || errors.Is(err, auth.ErrTokenExpired) {
					w.Header().Set("WWW-Authenticate", `Bearer realm="useshortly"`)
				}
				handler.WriteError(w, r, err)
				return
			}
			p = handler.Principal{UserID: u.ID, User: u}
		}
		next.ServeHTTP(w, r.WithContext(handler.WithPrincipal(r.Context(), p)))
	})
}

func bearer(r *http.Request) (string, bool) {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return "", false
	}
	return token, true
}
