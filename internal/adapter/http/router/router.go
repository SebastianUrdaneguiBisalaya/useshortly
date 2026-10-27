// Package router is the only place that knows gorilla/mux and the URL layout.
package router

import (
	"net/http"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/middlewares"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/gorilla/mux"
)

type Handlers struct {
	Auth     *middlewares.Auth   // who is calling
	Tenant   *middlewares.Tenant // which organization they act on
	Accounts *handler.AuthHandler
	Orgs     *handler.OrgHandler
	APIKeys  *handler.APIKeyHandler
	Links    *handler.LinkHandler
	Stats    *handler.StatsHandler
	QR       *handler.QRHandler
	Pages    *handler.UnlockPageHandler
	Domains  *handler.DomainHandler
	// Limits protects the endpoints from floods and guessing; nil limits nothing.
	Limits *middlewares.RateLimits
}

func NewRouter(h Handlers) http.Handler {
	r := mux.NewRouter()
	r.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	}).Methods(http.MethodGet)

	api := r.PathPrefix("/api/v1").Subrouter()

	// Public: signup, sign-in and password reset. They share one budget per address, because each
	// request can cost an argon2id hash or an email and these are what attackers guess at.
	strict := api.NewRoute().Subrouter()
	strict.Use(h.Limits.StrictPerIP())
	strict.HandleFunc("/auth/register", h.Accounts.Register).Methods(http.MethodPost)
	strict.HandleFunc("/auth/register/verify", h.Accounts.VerifyRegistration).Methods(http.MethodPost)
	strict.HandleFunc("/auth/login", h.Accounts.Login).Methods(http.MethodPost)
	if h.Accounts.HasGoogle() {
		strict.HandleFunc("/auth/google", h.Accounts.Google).Methods(http.MethodPost)
	}
	strict.HandleFunc("/auth/forgot-password", h.Accounts.ForgotPassword).Methods(http.MethodPost)
	strict.HandleFunc("/auth/reset-password", h.Accounts.ResetPassword).Methods(http.MethodPost)

	sessions := api.NewRoute().Subrouter()
	sessions.Use(h.Limits.RefreshPerIP())
	sessions.HandleFunc("/auth/refresh", h.Accounts.Refresh).Methods(http.MethodPost)
	sessions.HandleFunc("/auth/logout", h.Accounts.Logout).Methods(http.MethodPost)

	// Signed-in users only (JWT). These routes involve no tenant yet.
	user := api.NewRoute().Subrouter()
	user.Use(h.Auth.User, h.Limits.PerPrincipal())
	user.HandleFunc("/me", h.Accounts.Me).Methods(http.MethodGet)
	if h.Accounts.CanDelete() {
		user.HandleFunc("/me/delete-code", h.Accounts.RequestDeletion).Methods(http.MethodPost)
		user.HandleFunc("/me", h.Accounts.DeleteAccount).Methods(http.MethodDelete)
	}
	user.HandleFunc("/orgs", h.Orgs.Create).Methods(http.MethodPost)
	user.HandleFunc("/orgs", h.Orgs.ListMine).Methods(http.MethodGet)
	user.HandleFunc("/invitations/{invitationID}/accept", h.Orgs.AcceptInvitation).Methods(http.MethodPost)
	user.HandleFunc("/invitations/{invitationID}/reject", h.Orgs.RejectInvitation).Methods(http.MethodPost)

	// Signed-in users acting on one organization: Tenant checks {orgID} once for all of them.
	userOrg := user.PathPrefix("/orgs/{orgID}").Subrouter()
	userOrg.Use(h.Tenant.Require)
	userOrg.HandleFunc("", h.Orgs.Get).Methods(http.MethodGet)
	userOrg.HandleFunc("", h.Orgs.Delete).Methods(http.MethodDelete)
	userOrg.HandleFunc("/members", h.Orgs.ListMembers).Methods(http.MethodGet)
	userOrg.HandleFunc("/members/{userID}", h.Orgs.RemoveMember).Methods(http.MethodDelete)
	userOrg.HandleFunc("/invitations", h.Orgs.Invite).Methods(http.MethodPost)
	userOrg.HandleFunc("/invitations", h.Orgs.ListInvitations).Methods(http.MethodGet)
	userOrg.HandleFunc("/api-keys", h.APIKeys.Create).Methods(http.MethodPost)
	userOrg.HandleFunc("/api-keys", h.APIKeys.List).Methods(http.MethodGet)
	userOrg.HandleFunc("/api-keys/{keyID}", h.APIKeys.Delete).Methods(http.MethodDelete)

	// JWT or API key, also bound to one organization.
	either := api.NewRoute().Subrouter()
	either.Use(h.Auth.UserOrKey, h.Limits.PerPrincipal())
	eitherOrg := either.PathPrefix("/orgs/{orgID}").Subrouter()
	eitherOrg.Use(h.Tenant.Require)
	// Creating and deleting need the write scope; listing only the read scope.
	eitherOrg.Handle("/links", middlewares.Scope(apikey.ScopeWrite)(http.HandlerFunc(h.Links.Create))).Methods(http.MethodPost)
	eitherOrg.Handle("/links", middlewares.Scope(apikey.ScopeRead)(http.HandlerFunc(h.Links.List))).Methods(http.MethodGet)
	eitherOrg.Handle("/links/{linkID}", middlewares.Scope(apikey.ScopeWrite)(http.HandlerFunc(h.Links.Delete))).Methods(http.MethodDelete)
	// The page protected links show: the organization's for all of them, or one link's own.
	for _, prefix := range []string{"/unlock-page", "/links/{linkID}/unlock-page"} {
		eitherOrg.Handle(prefix, middlewares.Scope(apikey.ScopeRead)(http.HandlerFunc(h.Pages.Get))).Methods(http.MethodGet)
		eitherOrg.Handle(prefix, middlewares.Scope(apikey.ScopeWrite)(http.HandlerFunc(h.Pages.Put))).Methods(http.MethodPut)
		eitherOrg.Handle(prefix, middlewares.Scope(apikey.ScopeWrite)(http.HandlerFunc(h.Pages.Delete))).Methods(http.MethodDelete)
	}
	eitherOrg.Handle("/unlock-page/history", middlewares.Scope(apikey.ScopeRead)(http.HandlerFunc(h.Pages.History))).Methods(http.MethodGet)
	eitherOrg.Handle("/domains", middlewares.Scope(apikey.ScopeWrite)(http.HandlerFunc(h.Domains.Create))).Methods(http.MethodPost)
	eitherOrg.Handle("/domains", middlewares.Scope(apikey.ScopeRead)(http.HandlerFunc(h.Domains.List))).Methods(http.MethodGet)
	eitherOrg.Handle("/domains/{domainID}", middlewares.Scope(apikey.ScopeRead)(http.HandlerFunc(h.Domains.Get))).Methods(http.MethodGet)
	eitherOrg.Handle("/domains/{domainID}/verify", middlewares.Scope(apikey.ScopeWrite)(http.HandlerFunc(h.Domains.Verify))).Methods(http.MethodPost)
	eitherOrg.Handle("/domains/{domainID}", middlewares.Scope(apikey.ScopeWrite)(http.HandlerFunc(h.Domains.Delete))).Methods(http.MethodDelete)
	eitherOrg.Handle("/links/{linkID}/qr", middlewares.Scope(apikey.ScopeRead)(http.HandlerFunc(h.QR.Get))).Methods(http.MethodGet)
	eitherOrg.Handle("/links/{linkID}/stats", middlewares.Scope(apikey.ScopeRead)(http.HandlerFunc(h.Stats.Get))).Methods(http.MethodGet)

	// Public redirect. Registered last so it never shadows /health or /api.
	redirects := r.NewRoute().Subrouter()
	redirects.Use(h.Limits.RedirectPerIP())
	redirects.HandleFunc("/{code:[0-9A-Za-z_-]{1,15}}", h.Links.Redirect).Methods(http.MethodGet)
	unlocks := r.NewRoute().Subrouter()
	unlocks.Use(h.Limits.UnlockPerIP())
	unlocks.HandleFunc("/{code:[0-9A-Za-z_-]{1,15}}/unlock", h.Links.Unlock).Methods(http.MethodPost)
	// Outermost, so the log sees the 500 that Recover writes and nothing escapes either.
	return middlewares.RequestLog(middlewares.Recover(r))
}
