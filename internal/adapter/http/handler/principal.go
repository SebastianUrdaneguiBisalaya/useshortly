package handler

import (
	"context"
	"net/http"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

// Principal is who is calling: a signed-in user (JWT) or an API key, which acts for its
// tenant on behalf of the user who created it. The middlewares set it; handlers read it.
type Principal struct {
	UserID int64
	User   user.User // set for JWT callers
	// KeyTenantID is the tenant an API key is bound to; zero for JWT callers.
	KeyTenantID int64
	// KeyScope is what that key may do; empty for JWT callers, who may do everything.
	KeyScope apikey.Scope
	// MCPScope is what a call made through the MCP server may do; empty for everyone else. Unlike
	// an API key it is not bound to a tenant: membership is checked as for the user it acts for.
	MCPScope apikey.Scope
}

func (p Principal) ViaAPIKey() bool { return p.KeyTenantID != 0 }

func (p Principal) ViaMCP() bool { return p.MCPScope != "" }

// Limit is the scope that caps this caller, if any: JWT users are not capped.
func (p Principal) Limit() (apikey.Scope, bool) {
	switch {
	case p.ViaAPIKey():
		return p.KeyScope, true
	case p.ViaMCP():
		return p.MCPScope, true
	}
	return "", false
}

// Tenant is the organization a request acts on, already checked against the Principal.
type Tenant struct {
	ID int64
}

type (
	principalKey struct{}
	tenantKey    struct{}
)

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

func PrincipalFrom(r *http.Request) Principal {
	p, _ := r.Context().Value(principalKey{}).(Principal)
	return p
}

func WithTenant(ctx context.Context, t Tenant) context.Context {
	return context.WithValue(ctx, tenantKey{}, t)
}

// tenantFrom fails closed: a route that forgot the Tenant middleware answers 500 instead
// of acting on an organization nobody checked.
func tenantFrom(w http.ResponseWriter, r *http.Request) (Tenant, bool) {
	t, ok := r.Context().Value(tenantKey{}).(Tenant)
	if !ok || t.ID == 0 {
		logInternal(r, errMissingTenant)
		WriteAPIError(w, http.StatusInternalServerError, "internal_error", "something went wrong")
		return Tenant{}, false
	}
	return t, true
}

type missingTenant struct{}

func (missingTenant) Error() string { return "route has {orgID} but no Tenant middleware" }

var errMissingTenant error = missingTenant{}
