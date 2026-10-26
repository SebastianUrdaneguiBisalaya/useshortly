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
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/repository/sqlite"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/config"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

// adapters are the pieces main builds from the environment (Redis, the email provider,
// Google). They are parameters so the wiring below can be tested with fakes.
type adapters struct {
	codes  user.CodeStore
	sender mailing.Sender
	google user.GoogleVerifier // nil disables Google sign-in
}

type app struct {
	handler http.Handler
	// mail sends in the background; call Wait on shutdown so pending emails finish.
	mail *mailing.Async
}

// newApp is the composition root: it builds the repositories on db, injects every port into
// the domain services through their constructors, and hands the services to the handlers.
func newApp(cfg *config.Config, db *sql.DB, a adapters) *app {
	// Repositories (adapters of the domain ports).
	userRepo := sqlite.NewUserRepository(db)
	orgRepo := sqlite.NewOrgRepository(db)
	keyRepo := sqlite.NewAPIKeyRepository(db)
	linkRepo := sqlite.NewLinkRepository(db)
	refreshRepo := sqlite.NewRefreshTokenRepository(db)
	templateRepo := sqlite.NewEmailTemplateRepository(db)
	logRepo := sqlite.NewEmailLogRepository(db)

	// Email: render a template, send it, log the attempt; always in the background so it
	// can never slow down or fail the request that triggered it.
	mail := mailing.NewAsync(mailing.NewService(templateRepo, logRepo, a.sender, cfg.AppURL))

	tokens := jwt.NewJwtService(cfg.JWTSecret, cfg.JWTTTL)
	passwords := hasher.NewArgon2id()
	otp := user.NewOTP(a.codes, cfg.OTPSecret)

	users := user.NewService(userRepo, passwords, tokens, mail, otp)
	reset := user.NewPasswordResetService(userRepo, passwords, otp, mail, refreshRepo)
	var google *user.GoogleService
	if a.google != nil {
		google = user.NewGoogleService(userRepo, a.google, tokens, mail)
	}
	orgs := org.NewService(orgRepo, mail, refreshRepo)
	keys := apikey.NewService(keyRepo)
	links := link.NewService(linkRepo, codegen.NewBase62())

	return &app{
		mail: mail,
		handler: router.NewRouter(router.Handlers{
			Auth:     middlewares.NewAuth(users, keys),
			Tenant:   middlewares.NewTenant(orgs),
			Accounts: handler.NewAuthHandler(users, google, reset),
			Orgs:     handler.NewOrgHandler(orgs),
			APIKeys:  handler.NewAPIKeyHandler(keys),
			Links:    handler.NewLinkHandler(links, cfg.AppURL),
		}),
	}
}
