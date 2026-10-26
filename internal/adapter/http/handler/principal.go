package handler

import (
	"context"
	"net/http"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

// Principal is who is calling: a signed-in user (JWT) or an API key, which acts for its
// tenant on behalf of the user who created it. The middlewares set it; handlers read it.
type Principal struct {
	UserID int64
	User   user.User // set for JWT callers
	// KeyTenantID is the tenant an API key is bound to; zero for JWT callers.
	KeyTenantID int64
}

func (p Principal) ViaAPIKey() bool { return p.KeyTenantID != 0 }

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
