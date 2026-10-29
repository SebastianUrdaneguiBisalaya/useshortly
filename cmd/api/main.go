package main

import (
	"context"
	"fmt"
	"log"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // zone names such as America/Lima must resolve in minimal images (debian-slim has no tzdata) too

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/auth/google"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/auth/mcptoken"
	dnsadapter "github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/dns"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/geoip"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/middlewares"
	limiterredis "github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/limiter/redis"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/mailing/logsender"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/mailing/resend"
	otpredis "github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/otp/redis"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/config"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/cache"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/database"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/platform/server"
)

// @title                      useshortly API
// @version                    1.0
// @description                Self-hosted URL shortener. JSON keys are snake_case; every success is {"data": ...} and every failure {"error": {...}}.
// @BasePath                   /api/v1
// @securityDefinitions.apikey BearerAuth
// @in                         header
// @name                       Authorization
// @description                "Bearer <token>": a JWT access token, or an API key where the route allows it.
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	db, err := database.NewSQLite(ctx, database.SQLiteConfig{
		Path:      cfg.DatabasePath,
		RemoteURL: cfg.TursoDatabaseUrl,
		AuthToken: cfg.TursoAuthToken,
	})
	if err != nil {
		return err
	}
	defer db.Close()
	syncDone := make(chan struct{})
	go func() {
		defer close(syncDone)
		db.RunSync(ctx, cfg.SyncInterval)
	}()
	defer func() {
		stop()
		<-syncDone
	}()

	redisClient, err := cache.NewRedisClient(ctx, cfg.RedisUrl)
	if err != nil {
		return err
	}
	defer redisClient.Close()

	var sender mailing.Sender = logsender.New()
	if cfg.ResendAPIKey != "" {
		sender = resend.New(cfg.ResendAPIKey, cfg.MailFrom)
	} else {
		log.Println("RESEND_API_KEY is not set: emails are only logged, not sent")
	}

	var googleAuth user.GoogleAuth
	if cfg.GoogleClientID != "" {
		if googleAuth, err = google.New(ctx, google.Client{ID: cfg.GoogleClientID, Secret: cfg.GoogleSecret}, cfg.GoogleRedirect, google.Client{ID: cfg.GoogleDesktopClientID, Secret: cfg.GoogleDesktopSecret}); err != nil {
			return err
		}
	} else {
		log.Println("GOOGLE_CLIENT_ID is not set: Google sign-in is disabled")
	}

	ad := adapters{codes: otpredis.NewStore(redisClient), sender: sender, google: googleAuth, linkCache: cache.NewRedisStore(redisClient), attempts: limiterredis.NewLimiter(redisClient), dns: dnsadapter.NewResolver()}
	if cfg.GeoIPPath != "" {
		geo, err := geoip.Open(cfg.GeoIPPath)
		if err != nil {
			return err
		}
		defer geo.Close()
		ad.countries = geo
	} else {
		log.Println("GEOIP_DB_PATH is not set: the country of clicks is not recorded")
	}
	if cfg.MCPPublicKey != "" {
		key, err := mcptoken.ParsePublicKey(cfg.MCPPublicKey)
		if err != nil {
			return fmt.Errorf("MCP_PUBLIC_KEY: %w", err)
		}
		ad.mcp = mcptoken.NewVerifier(key)
	} else {
		log.Println("MCP_PUBLIC_KEY is not set: MCP access is disabled")
	}
	if cfg.RateLimit {
		ad.limits = middlewares.DefaultRateLimits(cfg.TrustProxy)
	} else {
		log.Println("RATE_LIMIT is false: requests are not rate limited")
	}
	a := newApp(cfg, db.DB, ad)
	// Let emails still in flight finish before the database and Redis close.
	defer a.mail.Wait()
	// Delete what deleted organizations left behind; stop it before the database closes.
	purgeCtx, stopPurge := context.WithCancel(ctx)
	purgeDone := make(chan struct{})
	go func() {
		defer close(purgeDone)
		a.purger.Run(purgeCtx)
	}()
	defer func() {
		stopPurge()
		<-purgeDone
	}()
	// Flush the queued clicks before the database closes.
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := a.clicks.Close(ctx); err != nil {
			log.Printf("clicks not flushed: %v", err)
		}
	}()

	return server.NewServer(cfg.Port, a.handler).Run(ctx)
}
