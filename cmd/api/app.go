package main

import (
	"database/sql"
	"net/http"

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
}

type app struct {
	handler http.Handler
	// mail sends in the background; call Wait on shutdown so pending emails finish.
	mail *mailing.Async
	// clicks writes the click log in the background; Close it on shutdown to flush what is queued.
	clicks *analytics.Recorder
}

// newApp is the composition root: it builds the repositories on db, injects every port into
// the domain services through their constructors, and hands the services to the handlers.
func newApp(cfg *config.Config, db *sql.DB, a adapters) *app {
	// Repositories (adapters of the domain ports).
	userRepo := sqlite.NewUserRepository(db)
	orgRepo := sqlite.NewOrgRepository(db)
	keyRepo := sqlite.NewAPIKeyRepository(db)
	var linkRepo link.Repository = sqlite.NewLinkRepository(db)
	if a.linkCache != nil {
		linkRepo = cached.NewLinkRepository(linkRepo, a.linkCache, cfg.LinkCacheTTL)
	}
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
	var google *user.GoogleService
	if a.google != nil {
		google = user.NewGoogleService(userRepo, a.google, tokens, refresh, mail)
	}
	orgs := org.NewService(orgRepo, mail)
	keys := apikey.NewService(keyRepo)
	links := link.NewService(linkRepo, codegen.NewBase62(), passwords, a.attempts)
	clickRepo := sqlite.NewClickRepository(db)
	clicks := analytics.NewRecorder(clickRepo, analytics.NewEnrichment(useragent.New(), a.countries), clickBuffer)
	stats := analytics.NewService(clickRepo)
	pages := unlockpage.NewService(sqlite.NewUnlockPageRepository(db))

	return &app{
		mail:   mail,
		clicks: clicks,
		handler: router.NewRouter(router.Handlers{
			Auth:     middlewares.NewAuth(users, keys),
			Tenant:   middlewares.NewTenant(orgs),
			Accounts: handler.NewAuthHandler(users, google, reset),
			Orgs:     handler.NewOrgHandler(orgs),
			APIKeys:  handler.NewAPIKeyHandler(keys),
			Links:    handler.NewLinkHandler(links, clicks, cfg.AppURL, cfg.TrustProxy).WithUnlockPages(pages),
			Stats:    handler.NewStatsHandler(stats),
			Pages:    handler.NewUnlockPageHandler(pages),
			QR:       handler.NewQRHandler(links, qr.NewService(qradapter.NewGenerator()), cfg.AppURL),
		}),
	}
}
