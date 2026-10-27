package middlewares

import (
	"net/http"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
)

// Scope refuses an API key or MCP token whose scope is below what the route needs. JWT users are not
// limited by it: their power is the membership Tenant already checked. It must run after Auth.
func Scope(required apikey.Scope) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if have, capped := handler.PrincipalFrom(r).Limit(); capped && !have.Allows(required) {
				handler.WriteAPIError(w, http.StatusForbidden, "insufficient_scope",
					"this credential has the "+string(have)+" scope, this endpoint needs "+string(required))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
