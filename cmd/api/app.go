package main

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/auth/jwt"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/codegen"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/hasher"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/middlewares"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/router"
	qradapter "github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/qr"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/repository/cached"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/repository/sqlite"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/useragent"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/config"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/domain"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/qr"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/unlockpage"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

// clickBuffer is how many clicks can wait for the database before new ones are dropped.
const clickBuffer = 1024

// adapters are the pieces main builds from the environment (Redis, the email provider,
// Google). They are parameters so the wiring below can be tested with fakes.
type adapters struct {
	codes  user.CodeStore
	sender mailing.Sender
	google user.GoogleAuth // nil disables Google sign-in
	// linkCache sits in front of the redirect lookup; nil serves every redirect from the database.
	linkCache cached.Store
	// countries finds the country of a click's address; nil leaves the country empty.
	countries analytics.CountryResolver
	// attempts limits the password tries of protected links.
	attempts link.AttemptLimiter
	// dns reads the TXT records that verify custom domains.
	dns domain.DNSResolver
	// limits caps how fast one caller can hit the endpoints; nil limits nothing.
	limits *middlewares.RateLimits
}

type app struct {
	handler http.Handler
	// mail sends in the background; call Wait on shutdown so pending emails finish.
	mail *mailing.Async
	// clicks writes the click log in the background; Close it on shutdown to flush what is queued.
	clicks *analytics.Recorder
	// purger deletes the links of deleted organizations in the background; run it with Run.
	purger *org.Purger
}

// noEviction is the link evictor when there is no cache: nothing is cached, so nothing to drop.
type noEviction struct{}

func (noEviction) Evict(context.Context, []int64) error { return nil }

// newApp is the composition root: it builds the repositories on db, injects every port into
// the domain services through their constructors, and hands the services to the handlers.
func newApp(cfg *config.Config, db *sql.DB, a adapters) *app {
	// Repositories (adapters of the domain ports).
	userRepo := sqlite.NewUserRepository(db)
	orgRepo := sqlite.NewOrgRepository(db)
	keyRepo := sqlite.NewAPIKeyRepository(db)
	var linkRepo link.Repository = sqlite.NewLinkRepository(db)
	var evictor org.LinkEvictor = noEviction{}
	if a.linkCache != nil {
		c := cached.NewLinkRepository(linkRepo, a.linkCache, cfg.LinkCacheTTL)
		linkRepo, evictor = c, c
	}
	// Deleted organizations are purged in the background (see org.Purger).
	purger := org.NewPurger(sqlite.NewOrgPurgeRepository(db), evictor)
	refreshRepo := sqlite.NewRefreshTokenRepository(db)
	templateRepo := sqlite.NewEmailTemplateRepository(db)
	logRepo := sqlite.NewEmailLogRepository(db)

	// Email: render a template, send it, log the attempt; always in the background so it
	// can never slow down or fail the request that triggered it.
	mail := mailing.NewAsync(mailing.NewService(templateRepo, logRepo, a.sender, cfg.AppURL))

	tokens := jwt.NewJwtService(cfg.JWTSecret, cfg.JWTTTL)
	passwords := hasher.NewArgon2id()
	otp := user.NewOTP(a.codes, cfg.OTPSecret)

	// The refresh service also ends every session when a password is reset.
	refresh := auth.NewRefreshService(refreshRepo, cfg.RefreshTTL)

	users := user.NewService(userRepo, passwords, tokens, refresh, mail, otp)
	reset := user.NewPasswordResetService(userRepo, passwords, otp, mail, refresh)
	deletion := user.NewDeletionService(userRepo, otp, mail, purger)
	var google *user.GoogleService
	if a.google != nil {
		google = user.NewGoogleService(userRepo, a.google, tokens, refresh, mail)
	}
	orgs := org.NewService(orgRepo, mail).WithPurger(purger)
	keys := apikey.NewService(keyRepo)
	domains := domain.NewService(sqlite.NewDomainRepository(db), a.dns, cfg.JWTSecret, appHost(cfg.AppURL))
	links := link.NewService(linkRepo, codegen.NewBase62(), passwords, a.attempts).WithDomains(domains)
	clickRepo := sqlite.NewClickRepository(db)
	clicks := analytics.NewRecorder(clickRepo, analytics.NewEnrichment(useragent.New(), a.countries), clickBuffer)
	stats := analytics.NewService(clickRepo)
	pages := unlockpage.NewService(sqlite.NewUnlockPageRepository(db))

	return &app{
		mail:   mail,
		clicks: clicks,
		purger: purger,
		handler: router.NewRouter(router.Handlers{
			Auth:     middlewares.NewAuth(users, keys),
			Tenant:   middlewares.NewTenant(orgs),
			Accounts: handler.NewAuthHandler(users, google, reset).WithDeletion(deletion),
			Orgs:     handler.NewOrgHandler(orgs),
			APIKeys:  handler.NewAPIKeyHandler(keys),
			Links:    handler.NewLinkHandler(links, clicks, cfg.AppURL, cfg.TrustProxy).WithDomains(domains).WithUnlockPages(pages).WithUnlockFooter(orgs, cfg.AbuseEmail),
			Stats:    handler.NewStatsHandler(stats),
			Pages:    handler.NewUnlockPageHandler(pages),
			Domains:  handler.NewDomainHandler(domains),
			Limits:   a.limits,
			QR:       handler.NewQRHandler(links, qr.NewService(qradapter.NewGenerator()), cfg.AppURL),
		}),
	}
}

// appHost is the host of the instance's own URL, which no custom domain can claim.
func appHost(appURL string) string {
	u, err := url.Parse(appURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}
