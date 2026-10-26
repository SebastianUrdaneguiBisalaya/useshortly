package middlewares

import (
	"net/http"
	"strconv"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
	"github.com/gorilla/mux"
)

// Tenant guards every route with an {orgID} path variable: the caller must belong to that
// organization (a JWT user is a member of it; an API key was issued for it). Handlers then
// read the checked tenant from the context instead of validating it themselves.
// It must run after Auth.
type Tenant struct {
	orgs *org.Service
}

func NewTenant(orgs *org.Service) *Tenant {
	return &Tenant{orgs: orgs}
}

func (t *Tenant) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		orgID, err := strconv.ParseInt(mux.Vars(r)["orgID"], 10, 64)
		if err != nil || orgID <= 0 {
			handler.WriteAPIError(w, http.StatusNotFound, "not_found", "resource not found")
			return
		}
		p := handler.PrincipalFrom(r)
		tenant := handler.Tenant{ID: orgID}
		switch {
		case p.UserID == 0:
			handler.WriteAPIError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		case p.ViaAPIKey():
			if p.KeyTenantID != orgID {
				handler.WriteAPIError(w, http.StatusForbidden, "not_member", "this api key belongs to another organization")
				return
			}
		default:
			m, err := t.orgs.RequireMember(r.Context(), p.UserID, orgID)
			if err != nil {
				handler.WriteError(w, r, err)
				return
			}
			tenant.Role = m.Role
		}
		next.ServeHTTP(w, r.WithContext(handler.WithTenant(r.Context(), tenant)))
	})
}
