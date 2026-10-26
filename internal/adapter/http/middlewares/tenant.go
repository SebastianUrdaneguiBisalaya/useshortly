package middlewares

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
	"github.com/gorilla/mux"
)

// Tenant guards every route with an {orgID} path variable. The caller must belong to that
// organization: a JWT user is a member of it; an API key was issued for it and the member
// who created it still belongs to it. Handlers then read the checked tenant from the
// context instead of validating it themselves. It must run after Auth.
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
		if p.UserID == 0 {
			handler.WriteAPIError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		if p.ViaAPIKey() && p.KeyTenantID != orgID {
			handler.WriteAPIError(w, http.StatusForbidden, "not_member", "this api key belongs to another organization")
			return
		}
		// For an API key p.UserID is the member who created it: when they leave the
		// organization their keys stop working, with no key to hunt down and delete.
		if _, err := t.orgs.RequireMember(r.Context(), p.UserID, orgID); err != nil {
			if p.ViaAPIKey() && errors.Is(err, org.ErrNotMember) {
				handler.WriteAPIError(w, http.StatusForbidden, "api_key_owner_not_member",
					"the member who created this api key is no longer in the organization")
				return
			}
			handler.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(handler.WithTenant(r.Context(), handler.Tenant{ID: orgID})))
	})
}
